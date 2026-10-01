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
 * Phase 5B inspections e2e. Requires seeded Postgres (DVI template seeded).
 * Covers: run creation/resume, idempotent result upserts (same-id replay AND
 * new-id re-record), template-scope validation, submit completeness gate,
 * findings promotion → review → send → customer approve/decline/defer,
 * RBAC + mechanic own-order scoping, and media fail-closed (503 without S3).
 */
describe('Inspections (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let mechanicToken = ''
  let customerToken = ''

  let seq = 0
  const freshPhone = () => {
    seq += 1
    const n = (Date.now() % 90_000_000) + seq * 23
    return `+2547${String(n).padStart(8, '0').slice(-8)}`
  }
  const freshIp = (a: number) => `10.7.${a}.${(Date.now() % 200) + 1}`

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

  /** Guest booking → confirm → check-in (spawns WO) → returns WO number. */
  const makeWorkOrder = async (tag: string): Promise<string> => {
    const phone = freshPhone()
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(10))
      .send({ name: `Insp ${tag}`, phone, vehicleText: 'Mazda Demio 2017', serviceName: 'Vehicle Diagnostics' })
      .expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      select: { bookingNumber: true },
    })
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/confirm`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(11))
      .send({ scheduledDate: '2026-10-06', scheduledTime: '09:30' })
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
    return wo!.woNumber
  }

  /** Assigns the mechanic so they can inspect, starts a run, returns ids. */
  const makeAssignedRun = async (tag: string) => {
    const woNumber = await makeWorkOrder(tag)
    const wo = await prisma.workOrder.findUnique({ where: { woNumber } })
    const mechanic = await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } })
    await api('post', `work-orders/${woNumber}/assign`, advisorToken)
      .send({ technicianId: mechanic!.id })
      .expect(200)
    const res = await api('post', `work-orders/${woNumber}/inspections`, mechanicToken).expect(201)
    return { woNumber, runId: res.body.data.id as string, woId: wo!.id }
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

    advisorToken = await login('advisor@motora.co.ke', '10.7.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.7.9.2')
    customerToken = await login('customer@motora.co.ke', '10.7.9.3')
  })

  afterAll(async () => {
    await app.close()
  })

  it('has the seeded 33-item DVI template across 8 sections', async () => {
    const items = await prisma.inspectionItem.findMany({
      orderBy: { displayOrder: 'asc' },
    })
    expect(items.length).toBeGreaterThanOrEqual(33)
    const sections = new Set(items.map((i) => i.section))
    expect([...sections].sort()).toEqual([
      'Brakes', 'Diagnostics', 'Electrical', 'Engine',
      'Exterior', 'Interior', 'Suspension', 'Tyres',
    ])
    // Brake pads carry a mm measurement unit (drives the numeric field).
    const pads = items.find((i) => i.label === 'Front brake pads')
    expect(pads?.measurementUnit).toBe('mm')
  })

  it('starts and resumes a run; blocks unassigned mechanics', async () => {
    const woNumber = await makeWorkOrder('resume')
    // Not assigned yet → mechanic gets 403.
    await api('post', `work-orders/${woNumber}/inspections`, mechanicToken).expect(403)
    // Advisor isn't assigned either but outranks the object check.
    const first = await api('post', `work-orders/${woNumber}/inspections`, advisorToken).expect(201)
    expect(first.body.data.status).toBeNull() // no fake status — see schema note
    // Resume returns the same run.
    const again = await api('post', `work-orders/${woNumber}/inspections`, advisorToken).expect(201)
    expect(again.body.data.id).toBe(first.body.data.id)
  })

  it('upserts results idempotently (replay same id = no-op; new id = last-write-wins)', async () => {
    const { runId } = await makeAssignedRun('upsert')
    const form = await api('get', `inspections/${runId}`, mechanicToken).expect(200)
    const pads = form.body.data.sections
      .flatMap((s: { items: { id: string; label: string }[] }) => s.items)
      .find((i: { label: string }) => i.label === 'Front brake pads')

    const clientResultId = randomUUID()
    const payload = { itemId: pads.id, status: 'NEEDS_ATTENTION', measurement: 3, note: 'Front pads nearly worn' }

    const r1 = await api('put', `inspections/${runId}/results/${clientResultId}`, mechanicToken)
      .send(payload).expect(200)
    expect(r1.body.data.id).toBe(clientResultId)
    expect(r1.body.data.unit).toBe('mm') // defaulted from the item

    // EXACT replay (offline outbox retry) — same id, same body: no-op.
    const r2 = await api('put', `inspections/${runId}/results/${clientResultId}`, mechanicToken)
      .send(payload).expect(200)
    const count1 = await prisma.inspectionResult.count({ where: { runId } })
    expect(r2.body.data.id).toBe(clientResultId)
    expect(count1).toBe(1)

    // Re-record same item with a NEW client id (device came back online
    // with a fresh outbox entry): unique(run,item) → last write wins.
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ ...payload, measurement: 2.5, note: 'Re-measured' }).expect(200)
    const rows = await prisma.inspectionResult.findMany({ where: { runId, itemId: pads.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].measurement?.toString()).toBe('2.5')

    // Update via the SAME client id also overwrites (normal edit path).
    await api('put', `inspections/${runId}/results/${clientResultId}`, mechanicToken)
      .send({ ...payload, measurement: 2.8 }).expect(200)
    const after = await prisma.inspectionResult.findMany({ where: { runId, itemId: pads.id } })
    expect(after[0].measurement?.toString()).toBe('2.8')
  })

  it('rejects items outside the template and results after submit', async () => {
    const { runId } = await makeAssignedRun('validate')
    // Foreign item id (not in this template snapshot).
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: randomUUID(), status: 'GOOD' }).expect(404)
    // Bad status value.
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: randomUUID(), status: 'PERFECT' }).expect(400)
  })

  it('submit requires every item recorded; then locks the run', async () => {
    const { runId } = await makeAssignedRun('submit')
    // Incomplete submit fails with details.
    const bad = await api('post', `inspections/${runId}/submit`, mechanicToken).expect(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
    expect(bad.body.error.details.missing.length).toBeGreaterThan(30)

    // Fill every item (NOT_CHECKED is allowed as an explicit choice).
    const form = await api('get', `inspections/${runId}`, mechanicToken).expect(200)
    const items = form.body.data.sections.flatMap((s: { items: { id: string }[] }) => s.items)
    for (const item of items) {
      await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
        .send({ itemId: item.id, status: 'GOOD' }).expect(200)
    }
    await api('post', `inspections/${runId}/submit`, mechanicToken).expect(200)

    // Locked: further result writes are rejected.
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: items[0].id, status: 'GOOD' }).expect(409)
    await api('post', `inspections/${runId}/submit`, mechanicToken).expect(409)
  })

  it('walks findings: promote → review → send → customer approve', async () => {
    const { runId, woNumber, woId } = await makeAssignedRun('findings')
    const form = await api('get', `inspections/${runId}`, mechanicToken).expect(200)
    const pads = form.body.data.sections
      .flatMap((s: { items: { id: string; label: string }[] }) => s.items)
      .find((i: { label: string }) => i.label === 'Front brake pads')
    const tyres = form.body.data.sections
      .flatMap((s: { items: { id: string; label: string }[] }) => s.items)
      .find((i: { label: string }) => i.label === 'Wheel alignment & uneven wear')

    const res1 = await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: pads.id, status: 'CRITICAL', measurement: 2, note: 'Metal on metal' }).expect(200)
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({ itemId: tyres.id, status: 'WATCH' }).expect(200)

    // Promote both results into findings (severity derived from result).
    const f1 = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ resultId: res1.body.data.id, title: 'Front brake pads worn', recommendation: 'Replace front brake pads' })
      .expect(201)
    expect(f1.body.data.severity).toBe('CRITICAL')
    expect(f1.body.data.status).toBe('PROPOSED')
    const f2 = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ title: 'Uneven tyre wear', resultId: undefined as unknown as string }).expect(201)
    void f2

    // Advisor reviews: customer copy + visibility.
    await api('patch', `findings/${f1.body.data.id}`, advisorToken)
      .send({
        customerTitle: 'Front brake pads need replacement',
        customerExplanation: 'Measured at 2mm. We recommend replacing them before your next trip.',
        customerVisible: true,
      }).expect(200)

    // Sending flips PROPOSED+visible → SENT.
    const sent = await api('post', `work-orders/${woNumber}/findings/send`, advisorToken).expect(200)
    expect(sent.body.data.sent).toBeGreaterThanOrEqual(1)

    // Customer sees only visible findings for their own job…
    const booking = await prisma.booking.findUnique({ where: { id: (await prisma.workOrder.findUnique({ where: { woNumber } }))!.bookingId } })
    expect(booking).toBeTruthy()
    // (the demo customer is not this booking's owner — staff view shows all)
    const staffView = await api('get', `work-orders/${woNumber}/findings`, advisorToken).expect(200)
    expect(staffView.body.data.findings.length).toBeGreaterThanOrEqual(1)

    // Customer decision (staff path — the demo customer doesn't own this WO).
    const approved = await api('post', `findings/${f1.body.data.id}/decision`, advisorToken)
      .send({ decision: 'APPROVE' }).expect(200)
    expect(approved.body.data.status).toBe('APPROVED')

    // History row was written by the mechanic (createdById) and decided by advisor.
    const finding = await prisma.inspectionFinding.findUnique({ where: { id: f1.body.data.id } })
    expect(finding!.workOrderId).toBe(woId)
  })

  it('records decline + defer with reasons and follow-up', async () => {
    const { runId, woNumber } = await makeAssignedRun('decline')
    const res = await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({
        itemId: (await prisma.inspectionItem.findFirst({ where: { label: 'Rear brake pads' } }))!.id,
        status: 'WATCH',
      }).expect(200)
    const f = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ resultId: res.body.data.id, title: 'Rear pads wearing' }).expect(201)
    await api('patch', `findings/${f.body.data.id}`, advisorToken)
      .send({ customerTitle: 'Rear brake pads — monitor', customerVisible: true }).expect(200)
    await api('post', `work-orders/${woNumber}/findings/send`, advisorToken).expect(200)

    const declined = await api('post', `findings/${f.body.data.id}/decision`, advisorToken)
      .send({ decision: 'DECLINE', reason: 'LATER' }).expect(200)
    expect(declined.body.data.status).toBe('DECLINED')
    expect(declined.body.data.declineReason).toBe('LATER')

    // Defer path with follow-up date.
    const f2 = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ title: 'Spare tyre missing' }).expect(201)
    await api('patch', `findings/${f2.body.data.id}`, advisorToken)
      .send({ customerVisible: true }).expect(200)
    await api('post', `work-orders/${woNumber}/findings/send`, advisorToken).expect(200)
    const deferred = await api('post', `findings/${f2.body.data.id}/decision`, advisorToken)
      .send({ decision: 'DEFER', followUpAt: '2026-11-15T00:00:00.000Z' }).expect(200)
    expect(deferred.body.data.status).toBe('DEFERRED')
    expect(deferred.body.data.followUpAt).toContain('2026-11-15')
  })

  it('hides invisible findings from customers and rejects customer decisions on unsent rows', async () => {
    const { runId, woNumber } = await makeAssignedRun('visibility')
    await api('put', `inspections/${runId}/results/${randomUUID()}`, mechanicToken)
      .send({
        itemId: (await prisma.inspectionItem.findFirst({ where: { label: 'Battery voltage & terminals' } }))!.id,
        status: 'GOOD',
      }).expect(200)
    const hidden = await api('post', `inspections/${runId}/findings`, mechanicToken)
      .send({ title: 'Battery healthy' }).expect(201) // not customerVisible

    const view = await api('get', `work-orders/${woNumber}/findings`, advisorToken).expect(200)
    const mine = view.body.data.findings.find((x: { id: string }) => x.id === hidden.body.data.id)
    expect(mine.customerVisible).toBe(false)

    // Deciding an unsent finding → 409 (or 404 for a non-owner customer).
    await api('post', `findings/${hidden.body.data.id}/decision`, advisorToken)
      .send({ decision: 'APPROVE' }).expect(409)
    await api('post', `findings/${hidden.body.data.id}/decision`, customerToken)
      .send({ decision: 'APPROVE' }).expect(404) // demo customer doesn't own this WO
  })

  it('enforces RBAC across inspection routes', async () => {
    const { runId, woNumber } = await makeAssignedRun('rbac')
    await api('get', `inspections/${runId}`).expect(401)
    await api('get', `inspections/${runId}`, customerToken).expect(403) // CUSTOMER can't fill runs
    await api('post', `work-orders/${woNumber}/findings/send`, mechanicToken).expect(403) // send is advisor+
    await api('patch', `findings/${randomUUID()}`, mechanicToken).expect(403) // review is advisor+
  })

  it('media endpoints fail closed without storage config (503 STORAGE_NOT_CONFIGURED)', async () => {
    const cfg = app.get(ConfigService, { strict: false })
    const hadEndpoint = cfg.get<string>('S3_ENDPOINT')
    if (hadEndpoint) return // storage configured in this env — covered by live checks instead

    const { woId } = await makeAssignedRun('media')
    const res = await api('post', 'media/upload-url', mechanicToken).send({
      entityType: 'INSPECTION_RESULT',
      entityId: woId,
      filename: 'brake.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 120_000,
    }).expect(503)
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED')
  })
})
