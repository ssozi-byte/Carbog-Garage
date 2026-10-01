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
 * Phase 5A work orders (the job card) e2e. Requires seeded Postgres.
 * Covers: check-in spawns the WO atomically (type mapping, complaint
 * verbatim, idempotent), the §3 state machine (walk, parts loop, illegal
 * jumps, terminal permanence), RBAC + mechanic own-order scoping, and
 * assignment with 404 cross-garage safety.
 */
describe('Work orders (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let advisorId = ''
  let mechanicToken = ''
  let mechanicId = ''
  let customerToken = ''

  let seq = 0
  const freshPhone = () => {
    seq += 1
    const n = (Date.now() % 90_000_000) + seq * 17
    return `+2547${String(n).padStart(8, '0').slice(-8)}`
  }
  const freshIp = (a: number) => `10.6.${a}.${(Date.now() % 200) + 1}`

  const guest = (body: Record<string, unknown>, ip: string) =>
    request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', ip)
      .send(body)

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
  }

  const api = (method: 'get' | 'post' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/work-orders${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})

  /** Same as api() but for routes outside the work-orders controller (QC etc.). */
  const apiAny = (method: 'get' | 'post' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})

  /** Guest booking → advisor check-in → returns the spawned WO number. */
  const makeWorkOrder = async (opts: { serviceName: string; message?: string }, tag: string) => {
    const phone = freshPhone()
    await guest(
      {
        name: `WO Test ${tag}`,
        phone,
        vehicleText: 'Toyota Premio 2018',
        serviceName: opts.serviceName,
        message: opts.message,
      },
      freshIp(10 + (seq % 100)),
    ).expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      select: { bookingNumber: true, id: true },
    })
    // REQUESTED → CONFIRMED → CHECKED_IN (booking machine requires the slot first)
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/confirm`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(19))
      .send({ scheduledDate: '2026-10-05', scheduledTime: '09:00' })
      .expect(200)
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/check-in`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(20))
      .send({})
      .expect(200)
    const wo = await prisma.workOrder.findUnique({ where: { bookingId: booking!.id } })
    return wo!
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

    advisorToken = await login('advisor@motora.co.ke', '10.6.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.6.9.2')
    customerToken = await login('customer@motora.co.ke', '10.6.9.3')
    advisorId = (await prisma.user.findUnique({ where: { email: 'advisor@motora.co.ke' } }))!.id
    mechanicId = (await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } }))!.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('spawns a work order at check-in — type mapping, complaint verbatim, history, audit', async () => {
    const wo = await makeWorkOrder(
      { serviceName: 'Vehicle Diagnostics', message: 'Brakes squeak when cold' },
      'spawn',
    )
    expect(wo.status).toBe('CHECKED_IN')
    expect(wo.type).toBe('DIAGNOSTIC') // service name → type mapping
    expect(wo.complaint).toBe('Brakes squeak when cold') // customer's words, verbatim
    expect(wo.vehicleText).toBe('Toyota Premio 2018')
    expect(wo.woNumber).toMatch(/^WO-\d{4}-\d{6}$/)

    const history = await prisma.workOrderStatusHistory.findMany({
      where: { workOrderId: wo.id },
    })
    expect(history).toHaveLength(1)
    expect(history[0].newStatus).toBe('CHECKED_IN')
    expect(history[0].actor).toBe('SYSTEM')

    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: 'WORK_ORDER', resourceId: wo.id, action: 'CREATE_WORK_ORDER' },
    })
    expect(audit).toBeTruthy()
    expect(audit!.actorId).toBe(advisorId)
  })

  it('never duplicates the work order (booking_id is unique; re-check-in is 409)', async () => {
    const wo = await makeWorkOrder({ serviceName: 'General Service' }, 'idem')
    const booking = await prisma.booking.findUnique({ where: { id: wo.bookingId } })
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${booking!.bookingNumber}/check-in`)
      .set('Authorization', `Bearer ${advisorToken}`)
      .set('X-Forwarded-For', freshIp(21))
      .send({})
      .expect(409) // CHECKED_IN → CHECKED_IN is not a legal booking transition
    const count = await prisma.workOrder.count({ where: { bookingId: wo.bookingId } })
    expect(count).toBe(1)
  })

  it('walks CHECKED_IN → INSPECTION → IN_PROGRESS → TESTING with actor identity', async () => {
    const wo = await makeWorkOrder({ serviceName: 'Brake Systems' }, 'walk')
    const r1 = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'INSPECTION', reason: 'vehicle on lift' }).expect(200)
    expect(r1.body.data.status).toBe('INSPECTION')

    const r2 = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'IN_PROGRESS' }).expect(200)
    expect(r2.body.data.startedAt).toBeTruthy() // stamped on IN_PROGRESS entry

    await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'TESTING' }).expect(200)

    const rows = await prisma.workOrderStatusHistory.findMany({
      where: { workOrderId: wo.id, newStatus: { not: 'CHECKED_IN' } },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.map((r) => r.newStatus)).toEqual(['INSPECTION', 'IN_PROGRESS', 'TESTING'])
    for (const r of rows) {
      expect(r.actor).toBe('STAFF')
      expect(r.changedByUserId).toBe(advisorId)
    }
  })

  it('allows WAITING_PARTS → IN_PROGRESS loop', async () => {
    const wo = await makeWorkOrder({ serviceName: 'Suspension & Steering' }, 'parts')
    await api('patch', `/${wo.woNumber}/status`, advisorToken).send({ status: 'INSPECTION' }).expect(200)
    await api('patch', `/${wo.woNumber}/status`, advisorToken).send({ status: 'IN_PROGRESS' }).expect(200)
    const w = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'WAITING_PARTS', reason: 'front shocks on order' }).expect(200)
    expect(w.body.data.status).toBe('WAITING_PARTS')
    const back = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'IN_PROGRESS' }).expect(200)
    expect(back.body.data.status).toBe('IN_PROGRESS')
  })

  it('rejects illegal jumps with 409 + allowed list', async () => {
    const wo = await makeWorkOrder({ serviceName: 'General Service' }, 'jump')
    const res = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' }).expect(409)
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION')
    expect(res.body.error.details.allowed).toEqual(['INSPECTION', 'IN_PROGRESS', 'CANCELLED'])
  })

  it('completes through QC → READY → COMPLETED; terminal is permanent', async () => {
    const wo = await makeWorkOrder({ serviceName: 'AC & Cooling' }, 'done')
    for (const s of ['INSPECTION', 'IN_PROGRESS', 'TESTING']) {
      await api('patch', `/${wo.woNumber}/status`, advisorToken).send({ status: s }).expect(200)
    }
    await api('post', `/${wo.woNumber}/assign`, advisorToken).send({ technicianId: mechanicId }).expect(200)
    // Submitting the QC performs TESTING → QUALITY_CHECK.
    await apiAny('post', `work-orders/${wo.woNumber}/submit-qc`, mechanicToken).send({
      repairCompleted: true, partsInstalled: true, noLeaks: true, warningLights: true,
      testDrive: true, toolsRemoved: true, vehicleCleaned: true, belongingsChecked: true,
    }).expect(200)
    // Phase 5E: QUALITY_CHECK → READY_FOR_COLLECTION is gated — no approved QC, no exit.
    const blocked = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' }).expect(409)
    expect(blocked.body.error.code).toBe('QC_NOT_APPROVED')
    const qc = await apiAny('get', `work-orders/${wo.woNumber}/qc-gate`, advisorToken).expect(200)
    const qcId = qc.body.data.latest?.id as string | undefined
    if (!qcId) throw new Error('qc-gate did not surface latestCheckId')
    await apiAny('post', `quality-checks/${qcId}/approve`, advisorToken).send({}).expect(200)
    await api('patch', `/${wo.woNumber}/status`, advisorToken).send({ status: 'READY_FOR_COLLECTION' }).expect(200)
    await api('patch', `/${wo.woNumber}/status`, advisorToken).send({ status: 'COMPLETED' }).expect(200)
    const res = await api('patch', `/${wo.woNumber}/status`, advisorToken)
      .send({ status: 'IN_PROGRESS' }).expect(409)
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION')
    const db = await prisma.workOrder.findUnique({ where: { id: wo.id } })
    expect(db!.completedAt).toBeTruthy()
  })

  it('blocks mechanics from moving unassigned orders; allows after assignment', async () => {
    const wo = await makeWorkOrder({ serviceName: 'Brake Systems' }, 'scope')

    // Not assigned → 403 for the mechanic.
    await api('patch', `/${wo.woNumber}/status`, mechanicToken)
      .send({ status: 'INSPECTION' }).expect(403)

    // Assigning requires SERVICE_ADVISOR+ — a mechanic gets 403 on the route.
    await api('post', `/${wo.woNumber}/assign`, mechanicToken)
      .send({ technicianId: mechanicId }).expect(403)

    await api('post', `/${wo.woNumber}/assign`, advisorToken)
      .send({ technicianId: mechanicId }).expect(200)

    // Assigned → the mechanic can move their own order.
    const res = await api('patch', `/${wo.woNumber}/status`, mechanicToken)
      .send({ status: 'INSPECTION' }).expect(200)
    expect(res.body.data.status).toBe('INSPECTION')
  })

  it('rejects assigning a technician from outside the garage (404, no leak)', async () => {
    const wo = await makeWorkOrder({ serviceName: 'Engine Service & Repair' }, 'assign404')
    const res = await api('post', `/${wo.woNumber}/assign`, advisorToken)
      .send({ technicianId: '00000000-0000-4000-8000-000000000000' }).expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('my-today lists only the signed-in technician\u2019s open jobs', async () => {
    const mine = await makeWorkOrder({ serviceName: 'Brake Systems' }, 'mine')
    const other = await makeWorkOrder({ serviceName: 'Brake Systems' }, 'other')
    await api('post', `/${mine.woNumber}/assign`, advisorToken)
      .send({ technicianId: mechanicId }).expect(200)

    const res = await api('get', '/my-today', mechanicToken).expect(200)
    const numbers = res.body.data.items.map((j: { woNumber: string }) => j.woNumber)
    expect(numbers).toContain(mine.woNumber)
    expect(numbers).not.toContain(other.woNumber)
    expect(typeof res.body.data.completedToday).toBe('number')
  })

  it('board returns open workshop orders and paginates the list', async () => {
    const res = await api('get', '/board', advisorToken).expect(200)
    expect(Array.isArray(res.body.data.items)).toBe(true)
    // Terminal orders never appear on the live board.
    expect(res.body.data.items.every((i: { status: string }) =>
      !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(i.status),
    )).toBe(true)

    const list = await api('get', '?limit=5', advisorToken).expect(200)
    expect(list.body.data.meta.limit).toBe(5)
    expect(list.body.data.meta.total).toBeGreaterThanOrEqual(1)
  })

  it('returns 404 WORK_ORDER_NOT_FOUND for unknown numbers (no existence leak)', async () => {
    const res = await api('get', '/WO-2099-999999', advisorToken).expect(404)
    expect(res.body.error.code).toBe('WORK_ORDER_NOT_FOUND')
    await api('patch', '/WO-2099-999999/status', advisorToken)
      .send({ status: 'INSPECTION' }).expect(404)
  })

  it('exposes the machine-readable transition table', async () => {
    const res = await api('get', '/status-machine', mechanicToken).expect(200)
    const inProgress = res.body.data.transitions.find((t: { status: string }) => t.status === 'IN_PROGRESS')
    expect(inProgress.allowed).toContain('WAITING_PARTS')
    expect(inProgress.allowed).toContain('TESTING')
    const completed = res.body.data.transitions.find((t: { status: string }) => t.status === 'COMPLETED')
    expect(completed.terminal).toBe(true)
  })

  it('enforces auth: 401 without token, 403 for CUSTOMER role', async () => {
    await api('get', '/board').expect(401)
    await api('get', '/board', customerToken).expect(403)
    await api('get', '/my-today', customerToken).expect(403)
    await api('get', '/WO-2099-999999', customerToken).expect(403)
  })
})
