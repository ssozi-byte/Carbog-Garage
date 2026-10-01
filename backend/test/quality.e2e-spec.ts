import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/database/prisma.service'
import { PinoLogger } from '../src/health/pino.logger'
import { RequestCtxMiddleware } from '../src/common/middleware/request-context.middleware'
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor'

/**
 * Phase 5E quality-control e2e (roadmap §15). Covers: mechanic submits the
 * fixed checklist from TESTING (walk + history), RBAC (advisor cannot
 * submit, mechanic cannot review), approve on a complete checklist, reject
 * → fix → resubmit → approve, the READY_FOR_COLLECTION gate (blocked
 * without QC, blocked on a rejected QC, open after approval), and the gate
 * view endpoint. Rerun-safe: fresh bookings per test, fresh IPs.
 */
describe('Quality control (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let mechanicToken = ''
  let cashierToken = ''

  let seq = 0
  let ipSeq = 0
  const freshIp = (base: number) => `10.12.${base}.${(ipSeq += 1) % 250}`

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .set('X-Forwarded-For', freshIp(15))

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
  }

  /** Guest booking → WO → assign → IN_PROGRESS → TESTING. */
  const makeTestingJob = async (tag: string): Promise<string> => {
    seq += 1
    const phone = `+2547${String((Date.now() % 90_000_000) + seq * 63).padStart(8, '0').slice(-8)}`
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(10))
      .send({ name: `QC ${tag}`, phone, vehicleText: 'Mazda Demio 2018', serviceName: 'Vehicle Diagnostics' })
      .expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      orderBy: { createdAt: 'desc' },
      select: { bookingNumber: true },
    })
    await api('post', `bookings/${booking!.bookingNumber}/confirm`, advisorToken)
      .send({ scheduledDate: '2026-10-08', scheduledTime: '10:00' })
      .expect(200)
    await api('post', `bookings/${booking!.bookingNumber}/check-in`, advisorToken).send({}).expect(200)
    const wo = await prisma.workOrder.findFirst({
      where: { booking: { bookingNumber: booking!.bookingNumber } },
      select: { woNumber: true },
    })
    const woNumber = wo!.woNumber
    const mechanic = await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } })
    await api('post', `work-orders/${woNumber}/assign`, advisorToken).send({ technicianId: mechanic!.id }).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'IN_PROGRESS' }).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'TESTING' }).expect(200)
    return woNumber
  }

  const fullChecklist = {
    repairCompleted: true,
    partsInstalled: true,
    noLeaks: true,
    warningLights: true,
    testDrive: true,
    toolsRemoved: true,
    vehicleCleaned: true,
    belongingsChecked: true,
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PinoLogger)
      .useValue({ info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined })
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

    advisorToken = await login('advisor@motora.co.ke', '10.12.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.12.9.2')
    cashierToken = await login('cashier@motora.co.ke', '10.12.9.3')
  })

  afterAll(async () => {
    await app.close()
  })

  it('submits from TESTING with the walk + history; RBAC: advisor cannot submit, mechanic cannot review', async () => {
    const woNumber = await makeTestingJob('submit')

    // Cashier cannot submit or review (financials ≠ QC).
    await api('post', `work-orders/${woNumber}/submit-qc`, cashierToken).send(fullChecklist).expect(403)
    // Advisor cannot submit QC (mechanic's job).
    await api('post', `work-orders/${woNumber}/submit-qc`, advisorToken).send(fullChecklist).expect(403)

    const res = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken)
      .send({ ...fullChecklist, notes: 'Runs clean' })
      .expect(200)
    expect(res.body.data).toMatchObject({ approved: null, complete: true })

    const wo = await prisma.workOrder.findUnique({ where: { woNumber }, select: { status: true } })
    expect(wo!.status).toBe('QUALITY_CHECK')
    const history = await prisma.workOrderStatusHistory.findMany({
      where: { workOrder: { woNumber } },
      orderBy: { createdAt: 'asc' },
    })
    expect(history[history.length - 1].newStatus).toBe('QUALITY_CHECK')

    // Mechanic has no review route.
    const qcId = res.body.data.id as string
    await api('post', `quality-checks/${qcId}/approve`, mechanicToken).send({}).expect(403)
    // Advisor sees it in the queue.
    const queue = await api('get', 'quality-checks', advisorToken).expect(200)
    expect(queue.body.data.items.some((q: { id: string }) => q.id === qcId)).toBe(true)
  })

  it('approves a complete checklist and opens the READY gate; incomplete submissions cannot be approved', async () => {
    const woNumber = await makeTestingJob('approve')

    // Incomplete submission…
    const bad = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken)
      .send({ ...fullChecklist, testDrive: false })
      .expect(200)
    expect(bad.body.data.complete).toBe(false)
    // …cannot be approved without a rejection reason.
    await api('post', `quality-checks/${bad.body.data.id}/approve`, advisorToken).send({}).expect(409)

    // Resubmission needs the legal walk back through TESTING.
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'IN_PROGRESS' }).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'TESTING' }).expect(200)
    const good = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken)
      .send(fullChecklist)
      .expect(200)
    const qcId = good.body.data.id as string

    // Gate view before approval: required, not open.
    const gateBefore = await api('get', `work-orders/${woNumber}/qc-gate`, mechanicToken).expect(200)
    expect(gateBefore.body.data).toMatchObject({ gateRequired: true, gateOpen: false })

    // READY is blocked without an approval…
    await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
      .expect(409)
    const blocked = await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
    expect(blocked.body.error.code).toBe('QC_NOT_APPROVED')

    await api('post', `quality-checks/${qcId}/approve`, advisorToken).send({}).expect(200)

    // …and opens once the advisor approves the latest check.
    await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
      .expect(200)
    const gateAfter = await api('get', `work-orders/${woNumber}/qc-gate`, advisorToken).expect(200)
    expect(gateAfter.body.data.gateOpen).toBe(true)

    // A decided check cannot be decided twice.
    await api('post', `quality-checks/${qcId}/approve`, advisorToken).send({}).expect(409)
  })

  it('rejects with a reason, blocks READY on the rejected QC, and accepts the resubmit-approve loop', async () => {
    const woNumber = await makeTestingJob('reject')

    const qc = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken)
      .send({ ...fullChecklist, noLeaks: false })
      .expect(200)

    const rej = await api('post', `quality-checks/${qc.body.data.id}/approve`, advisorToken)
      .send({ rejectedReason: 'Coolant weeping at the housing' })
      .expect(200)
    expect(rej.body.data).toMatchObject({ approved: false, rejectedReason: 'Coolant weeping at the housing' })

    // Gate still closed (latest check rejected).
    await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
      .expect(409)
    const gate = await api('get', `work-orders/${woNumber}/qc-gate`, mechanicToken).expect(200)
    expect(gate.body.data.gateOpen).toBe(false)

    // Mechanic fixes and resubmits from QUALITY_CHECK (legal edge back to TESTING).
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'IN_PROGRESS' }).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'TESTING' }).expect(200)
    const qc2 = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken)
      .send(fullChecklist)
      .expect(200)
    await api('post', `quality-checks/${qc2.body.data.id}/approve`, advisorToken).send({}).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
      .expect(200)

    // The rejected row keeps its outcome — history intact, never overwritten.
    const stored = await prisma.qualityCheck.findUnique({ where: { id: qc.body.data.id } })
    expect(stored!.approved).toBe(false)
    expect(stored!.rejectedReason).toContain('Coolant')
  })
})
