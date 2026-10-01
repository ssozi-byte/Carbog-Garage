import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import request from 'supertest'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/database/prisma.service'
import { PinoLogger } from '../src/health/pino.logger'
import { RequestCtxMiddleware } from '../src/common/middleware/request-context.middleware'
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor'

/**
 * Phase 5C estimates & approvals e2e. Requires seeded Postgres. Covers:
 * estimate build from findings (server-computed totals), RBAC (SA+ sends,
 * cashier excluded), send → OTP challenge, wrong phone/code defenses,
 * OTP approve (WO → APPROVED + finding flips + append-only ledger),
 * OTP decline (findings DEFERRED + followUpAt + deferred feed),
 * read-time expiry, and per-phone code throttling. Rerun-safe.
 */
describe('Estimates & approvals (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let mechanicToken = ''
  let cashierToken = ''

  let seq = 0
  let ipSeq = 0
  const freshPhone = () => {
    seq += 1
    const n = (Date.now() % 90_000_000) + seq * 41
    return `+2547${String(n).padStart(8, '0').slice(-8)}`
  }
  const freshIp = (base: number) => `10.9.${base}.${(ipSeq += 1) % 250}`

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .set('X-Forwarded-For', freshIp(30))

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
  }

  /** Guest booking → confirm → check-in (spawns WO) → WO number. */
  const makeWorkOrder = async (tag: string): Promise<{ woNumber: string; phone: string }> => {
    const phone = freshPhone()
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(10))
      .send({ name: `Est ${tag}`, phone, vehicleText: 'Toyota Fielder 2016', serviceName: 'Vehicle Diagnostics' })
      .expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      orderBy: { createdAt: 'desc' },
      select: { bookingNumber: true },
    })
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/confirm`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(11))
      .send({ scheduledDate: '2026-10-06', scheduledTime: '10:30' })
      .expect(200)
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/check-in`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(12))
      .send({})
      .expect(200)
    const wo = await prisma.workOrder.findFirst({
      where: { booking: { bookingNumber: booking!.bookingNumber } },
      select: { woNumber: true },
    })
    return { woNumber: wo!.woNumber, phone }
  }

  /**
   * Full 5A+5B+5C setup: WO + assigned mechanic + inspection result +
   * promoted finding + advisor review (visible) + estimate with a linked
   * finding + send. Returns everything a decision test needs.
   */
  const makeSentEstimate = async (
    tag: string,
    overrides: { price?: number; labourMilli?: number } = {},
  ) => {
    const { woNumber, phone } = await makeWorkOrder(tag)
    const wo = await prisma.workOrder.findUnique({ where: { woNumber } })
    const mechanic = await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } })
    await api('post', `work-orders/${woNumber}/assign`, advisorToken)
      .send({ technicianId: mechanic!.id })
      .expect(200)
    const run = await api('post', `work-orders/${woNumber}/inspections`, mechanicToken).expect(201)
    const runId = run.body.data.id as string
    const form = await api('get', `inspections/${runId}`, mechanicToken).expect(200)
    const pads = form.body.data.sections
      .flatMap((s: { items: { id: string; label: string }[] }) => s.items)
      .find((i: { label: string }) => i.label === 'Front brake pads')
    const result = await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: pads.id, status: 'NEEDS_ATTENTION', measurement: 3 })
      .expect(200)
    const finding = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ resultId: result.body.data.id, title: 'Front brake pads worn' })
      .expect(201)
    await api('patch', `findings/${finding.body.data.id}`, advisorToken)
      .send({
        customerTitle: 'Front brake pads need replacement',
        customerExplanation: 'Measured at 3mm — replace before your next trip.',
        customerVisible: true,
      })
      .expect(200)
    // 5B send: the finding must be SENT so estimate decisions can flip it.
    await api('post', `work-orders/${woNumber}/findings/send`, advisorToken)
      .set('X-Forwarded-For', freshIp(49))
      .expect(200)

    const unitPriceCents = overrides.price ?? 450_000 // KES 4,500.00
    const est = await api('post', `work-orders/${woNumber}/estimates`, advisorToken)
      .send({
        items: [
          { findingId: finding.body.data.id, kind: 'PART', description: 'Front brake pads (set)', qtyMilli: 1000, unitPriceCents },
          { kind: 'LABOUR', description: 'Brake service labour (0.5h)', qtyMilli: overrides.labourMilli ?? 500, unitPriceCents: 200_000 },
        ],
      })
      .expect(201)
    const estimateNumber = est.body.data.estimateNumber as string

    await api('post', `estimates/${estimateNumber}/send`, advisorToken)
      .set('X-Forwarded-For', freshIp(50))
      .expect(200)

    return { woNumber, phone, runId, findingId: finding.body.data.id as string, estimateNumber }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PinoLogger)
      .useValue({
        init: () => undefined, info: () => undefined, warn: () => undefined,
        error: () => undefined, debug: () => undefined, onModuleDestroy: () => undefined,
      })
      .compile()

    app = moduleRef.createNestApplication({ logger: false })
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] })
    app.use(helmet())
    app.use(compression())
    app.use(cookieParser())
    const requestCtx = new RequestCtxMiddleware()
    app.use((req: Request, res: Response, next: NextFunction) => requestCtx.use(req, res, next))
    const { ConfigService } = await import('@nestjs/config')
    const cfg = app.get(ConfigService, { strict: false })
    app.enableCors({ origin: [cfg.get('FRONTEND_URL', 'http://localhost:5173')], credentials: true })
    app.useGlobalInterceptors(new EnvelopeInterceptor())
    app.useGlobalFilters(new GlobalExceptionFilter())

    await app.init()
    prisma = app.get(PrismaService)

    advisorToken = await login('advisor@motora.co.ke', '10.9.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.9.9.2')
    cashierToken = await login('cashier@motora.co.ke', '10.9.9.3')
  })

  afterAll(async () => {
    await app.close()
  })

  it('builds an estimate from findings with server-computed integer totals; foreign findings rejected', async () => {
    const { woNumber } = await makeWorkOrder('build')
    const res = await api('post', `work-orders/${woNumber}/estimates`, advisorToken)
      .send({
        items: [
          { kind: 'PART', description: 'Front brake pads (set)', qtyMilli: 1000, unitPriceCents: 450_000 },
          { kind: 'LABOUR', description: 'Brake service labour (0.5h)', qtyMilli: 500, unitPriceCents: 200_000 },
        ],
      })
      .expect(201)
    const est = res.body.data
    expect(est.estimateNumber).toMatch(/^EST-\d{4}-\d{6}$/)
    expect(est.status).toBe('DRAFT')
    // 450000 + round(500*200000/1000)=100000 → subtotal 550000; VAT 16% = 88000
    expect(est.subtotalCents).toBe(550_000)
    expect(est.vatCents).toBe(88_000)
    expect(est.totalCents).toBe(638_000)

    // Draft rebuild replaces lines (still one estimate per work order).
    const rebuilt = await api('post', `work-orders/${woNumber}/estimates`, advisorToken)
      .send({ items: [{ kind: 'LABOUR', description: 'Diagnostic labour (1h)', qtyMilli: 1000, unitPriceCents: 150_000 }] })
      .expect(201)
    expect(rebuilt.body.data.estimateNumber).toBe(est.estimateNumber)
    expect(rebuilt.body.data.subtotalCents).toBe(150_000)
    expect(rebuilt.body.data.items).toHaveLength(1)

    // A finding from ANOTHER work order is rejected (no cross-job leaks).
    const other = await makeSentEstimate('foreign')
    await api('post', `work-orders/${woNumber}/estimates`, advisorToken)
      .send({
        items: [{ findingId: other.findingId, kind: 'PART', description: 'Stolen line', qtyMilli: 1000, unitPriceCents: 1 }],
      })
      .expect(400)
  })

  it('enforces RBAC: mechanic cannot build/send, cashier can build but never send', async () => {
    const { woNumber } = await makeWorkOrder('rbac')
    await api('post', `work-orders/${woNumber}/estimates`, mechanicToken)
      .send({ items: [{ kind: 'LABOUR', description: 'x labour', qtyMilli: 1000, unitPriceCents: 1 }] })
      .expect(403)
    await api('get', `work-orders/${woNumber}/estimate`, mechanicToken).expect(403)
    await api('post', `work-orders/${woNumber}/estimates`).expect(401)

    const est = await api('post', `work-orders/${woNumber}/estimates`, cashierToken)
      .send({ items: [{ kind: 'LABOUR', description: 'Cashier build allowed', qtyMilli: 1000, unitPriceCents: 5_000 }] })
      .expect(201)
    // Locked decision: CASHIER+ invoices (5E) but SENDS are SERVICE_ADVISOR+ only.
    await api('post', `estimates/${est.body.data.estimateNumber}/send`, cashierToken)
      .set('X-Forwarded-For', freshIp(51))
      .expect(403)
  })

  it('sends: DRAFT→SENT, ledger SENT row, WO walked to AWAITING_APPROVAL via legal moves, OTP challenge', async () => {
    const { woNumber, phone, estimateNumber } = await makeSentEstimate('send')
    const est = await api('get', `work-orders/${woNumber}/estimate`, advisorToken).expect(200)
    expect(est.body.data.status).toBe('SENT')
    expect(est.body.data.approvals).toHaveLength(1)
    expect(est.body.data.approvals[0].action).toBe('SENT')
    expect(est.body.data.approvals[0].actorType).toBe('STAFF')

    const wo = await prisma.workOrder.findUnique({ where: { woNumber } })
    expect(wo!.status).toBe('AWAITING_APPROVAL')
    const history = await prisma.workOrderStatusHistory.findMany({
      where: { workOrderId: wo!.id },
      orderBy: { createdAt: 'asc' },
    })
    const steps = history.filter((h) => h.newStatus !== 'CHECKED_IN').map((h) => h.newStatus)
    expect(steps).toEqual(['INSPECTION', 'AWAITING_APPROVAL'])

    // The OTP challenge round-trips (guest never registered a password).
    const otp = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
      .set('X-Forwarded-For', freshIp(52))
      .send({ phone })
      .expect(200)
    expect(otp.body.data.phone).toBe(phone)
    expect(otp.body.data.devCode).toMatch(/^\d{6}$/) // dev-only echo

    // Resend of a SENT estimate is a 409.
    await api('post', `estimates/${estimateNumber}/send`, advisorToken)
      .set('X-Forwarded-For', freshIp(53))
      .expect(409)
  })

  it('rejects wrong phones and wrong codes without leaking which failed', async () => {
    const { phone, estimateNumber } = await makeSentEstimate('wrongphone')
    const wrongPhone = freshPhone()

    // Viewing with someone else's phone → 404 (ownership proven server-side).
    await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/view`)
      .set('X-Forwarded-For', freshIp(54))
      .send({ phone: wrongPhone })
      .expect(404)
    // Deciding with someone else's phone+code fails at the OTP gate —
    // there is no live challenge for that phone (401, never a state leak).
    const wrong = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/approve`)
      .set('X-Forwarded-For', freshIp(55))
      .send({ phone: wrongPhone, code: '123456' })
      .expect(401)
    expect(wrong.body.error.code).toBe('OTP_INVALID')

    // Right phone, wrong code → 401 OTP_INVALID.
    await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
      .set('X-Forwarded-For', freshIp(56))
      .send({ phone })
      .expect(200)
    const bad = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/approve`)
      .set('X-Forwarded-For', freshIp(57))
      .send({ phone, code: '000000' })
      .expect(401)
    expect(bad.body.error.code).toBe('OTP_INVALID')
    // The estimate is still SENT — nothing decided.
    const est = await prisma.estimate.findUnique({ where: { estimateNumber } })
    expect(est!.status).toBe('SENT')
  })

  it('approves via one-shot {phone, code}: WO→APPROVED, findings→APPROVED, append-only ledger order', async () => {
    const { woNumber, phone, findingId, estimateNumber } = await makeSentEstimate('approve')

    // Customer opens the link: first phone-proven view records VIEWED once.
    const view1 = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/view`)
      .set('X-Forwarded-For', freshIp(58))
      .send({ phone })
      .expect(200)
    expect(view1.body.data.status).toBe('SENT')
    expect(view1.body.data.totalCents).toBeGreaterThan(0)
    expect(view1.body.data.items[0].finding.customerTitle).toBe('Front brake pads need replacement')
    await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/view`)
      .set('X-Forwarded-For', freshIp(59))
      .send({ phone })
      .expect(200)
    const viewedRows = await prisma.estimateApproval.count({ where: { estimate: { estimateNumber }, action: 'VIEWED' } })
    expect(viewedRows).toBe(1) // VIEWED is once-per-send, not once-per-fetch

    // One-shot approve: the code in the body is consumed by the decision.
    const code = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
      .set('X-Forwarded-For', freshIp(60))
      .send({ phone })
      .expect(200)
      .then((r) => r.body.data.devCode as string)
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/approve`)
      .set('X-Forwarded-For', freshIp(61))
      .send({ phone, code, note: 'Go ahead' })
      .expect(200)
    expect(approved.body.data.status).toBe('APPROVED')

    const wo = await prisma.workOrder.findUnique({ where: { woNumber } })
    expect(wo!.status).toBe('APPROVED')
    const finding = await prisma.inspectionFinding.findUnique({ where: { id: findingId } })
    expect(finding!.status).toBe('APPROVED')

    // The ledger is append-only and ordered: SENT → VIEWED → APPROVED.
    const ledger = await prisma.estimateApproval.findMany({
      where: { estimate: { estimateNumber } },
      orderBy: { createdAt: 'asc' },
    })
    expect(ledger.map((l) => l.action)).toEqual(['SENT', 'VIEWED', 'APPROVED'])
    expect(ledger[2].otpVerified).toBe(true)
    expect(ledger[2].note).toBe('Go ahead')

    // Deciding again fails at the OTP gate — the one-shot code was consumed,
    // so no second APPROVED row is even reachable.
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/approve`)
      .set('X-Forwarded-For', freshIp(62))
      .send({ phone, code })
      .expect(401)
    expect(replay.body.error.code).toBe('OTP_INVALID')
    const ledgerAfter = await prisma.estimateApproval.count({ where: { estimate: { estimateNumber } } })
    expect(ledgerAfter).toBe(3)
  })

  it('declines via Bearer scope token: findings DEFERRED + followUpAt + decline reason, WO back to INSPECTION', async () => {
    const { woNumber, phone, findingId, estimateNumber } = await makeSentEstimate('decline')

    // Two-step flow: verify once → short-lived scope token → Bearer decision.
    const otp = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
      .set('X-Forwarded-For', freshIp(63))
      .send({ phone })
      .expect(200)
    const code = otp.body.data.devCode as string
    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .set('X-Forwarded-For', freshIp(64))
      .send({ phone, code })
      .expect(200)
    const scopeToken = verify.body.data.scopeToken as string
    expect(verify.body.data.scope.estimateId).toBeTruthy()

    // Verify the code cannot be replayed.
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .set('X-Forwarded-For', freshIp(65))
      .send({ phone, code })
      .expect(401)

    const declined = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/decline`)
      .set('Authorization', `Bearer ${scopeToken}`)
      .set('X-Forwarded-For', freshIp(66))
      .send({ reason: 'TOO_EXPENSIVE', note: 'Next month maybe', followUpAt: '2026-11-01T09:00:00.000Z' })
      .expect(200)
    expect(declined.body.data.status).toBe('DECLINED')

    // Declined ≠ deleted: the finding persists as DEFERRED with reminder hook.
    const finding = await prisma.inspectionFinding.findUnique({ where: { id: findingId } })
    expect(finding!.status).toBe('DEFERRED')
    expect(finding!.declineReason).toBe('TOO_EXPENSIVE')
    expect(finding!.followUpAt?.toISOString()).toContain('2026-11-01')

    const wo = await prisma.workOrder.findUnique({ where: { woNumber } })
    expect(wo!.status).toBe('INSPECTION')

    // Phase 7 reminder feed already sees it.
    const feed = await api('get', 'estimates/deferred', advisorToken).expect(200)
    const row = feed.body.data.items.find((i: { id: string }) => i.id === findingId)
    expect(row).toBeTruthy()
    expect(row.followUpAt).toContain('2026-11-01')

    const ledger = await prisma.estimateApproval.findMany({
      where: { estimate: { estimateNumber } },
      orderBy: { createdAt: 'asc' },
    })
    expect(ledger.map((l) => l.action)).toEqual(['SENT', 'DECLINED'])
    expect(ledger[1].declineReason).toBe('TOO_EXPENSIVE')
    expect(ledger[1].otpVerified).toBe(true)
  })

  it('stamps lapsed SENT estimates EXPIRED on read and blocks deciding them', async () => {
    const { phone, estimateNumber } = await makeSentEstimate('expired', { price: 123_456 })
    await prisma.estimate.update({
      where: { estimateNumber },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const view = await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/view`)
      .set('X-Forwarded-For', freshIp(67))
      .send({ phone })
      .expect(200)
    expect(view.body.data.status).toBe('EXPIRED')

    const est = await prisma.estimate.findUnique({ where: { estimateNumber } })
    expect(est!.status).toBe('EXPIRED') // stamped, not just projected

    await request(app.getHttpServer())
      .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
      .set('X-Forwarded-For', freshIp(68))
      .send({ phone })
      .expect(409) // nothing pending on an expired offer
  })

  it('throttles OTP requests per phone (3 per 15 min)', async () => {
    const { phone, estimateNumber } = await makeSentEstimate('throttle')
    const req = () =>
      request(app.getHttpServer())
        .post(`/api/v1/estimates/${estimateNumber}/otp-request`)
        .set('X-Forwarded-For', freshIp(69))
        .send({ phone })
    await req().expect(200)
    await req().expect(200)
    await req().expect(200)
    const fourth = await req().expect(429)
    expect(fourth.body.error.code).toBe('OTP_RATE_LIMITED')
  })
})
