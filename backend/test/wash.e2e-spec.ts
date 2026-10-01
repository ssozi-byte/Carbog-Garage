import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
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
 * Phase 6 car wash e2e (docs/platform-roadmap-v2.md §2.2/§3). A wash is a
 * WO with type=WASH plus ONE wash_jobs row spawned atomically at check-in;
 * the washer drives QUEUED → WASHING → VACUUMING → DETAILING →
 * QUALITY_CHECK → READY via POST /wash-jobs/:n/step (five-button UI), the
 * WO walks in parallel, and the two machines never bleed (workshop PATCH
 * refuses washes except COMPLETED/CANCELLED). Offline safety: X-Event-Id
 * replays are idempotent no-ops. Rerun-safe (fresh phones per test).
 */
describe('Car wash (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let washerToken = ''
  let washerId = ''
  let customerToken = ''

  let seq = 0
  let ipSeq = 0
  const freshIp = (base: number) => `10.14.${base}.${(ipSeq += 1) % 250}`

  const api = (method: 'get' | 'post' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .set('X-Forwarded-For', freshIp(18))

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
  }

  /** Guest booking for a WASH service → confirm → check-in → WO number. */
  const makeWashJob = async (tag: string, serviceName = 'Exterior Wash') => {
    seq += 1
    const phone = `+2547${String((Date.now() % 90_000_000) + seq * 91).padStart(8, '0').slice(-8)}`
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(11))
      .send({ name: `Wash ${tag}`, phone, vehicleText: 'Toyota Vitz 2016', serviceName })
      .expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      orderBy: { createdAt: 'desc' },
      select: { bookingNumber: true },
    })
    await api('post', `bookings/${booking!.bookingNumber}/confirm`, advisorToken)
      .send({ scheduledDate: '2026-10-10', scheduledTime: '09:00' })
      .expect(200)
    await api('post', `bookings/${booking!.bookingNumber}/check-in`, advisorToken).send({}).expect(200)
    const wo = await prisma.workOrder.findFirst({
      where: { booking: { bookingNumber: booking!.bookingNumber } },
      select: { woNumber: true },
    })
    return wo!.woNumber
  }

  /** Guest booking for a WORKSHOP service (for cross-machine tests). */
  const makeWorkshopJob = async (tag: string) => makeWashJob(tag, 'Vehicle Diagnostics')

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

    advisorToken = await login('advisor@motora.co.ke', '10.14.9.1')
    washerToken = await login('washer@motora.co.ke', '10.14.9.2')
    customerToken = await login('customer@motora.co.ke', '10.14.9.3')
    washerId = (await prisma.user.findUnique({ where: { email: 'washer@motora.co.ke' }, select: { id: true } }))!.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('spawns a WASH work order + QUEUED wash_jobs row at check-in; board and detail agree', async () => {
    const woNumber = await makeWashJob('spawn')
    const wo = await prisma.workOrder.findFirst({ where: { woNumber }, select: { id: true, type: true, status: true } })
    expect(wo!.type).toBe('WASH')
    expect(wo!.status).toBe('CHECKED_IN')

    const job = (await api('get', `wash-jobs/${woNumber}`, washerToken).expect(200)).body.data
    expect(job.currentStep).toBe('QUEUED')
    expect(job.service.name).toBe('Exterior Wash')
    expect(job.service.basePrice).toBe(50_000)
    expect(job.allowedNextSteps).toEqual(['WASHING'])
    expect(job.terminal).toBe(false)
    expect(job.stepHistory).toHaveLength(1) // the QUEUED creation row

    // The wash board shows it; the workshop board must NOT.
    const washBoard = (await api('get', 'wash-jobs', advisorToken).expect(200)).body.data.items
    expect(washBoard.some((w: { woNumber: string }) => w.woNumber === woNumber)).toBe(true)
    const workshopBoard = (await api('get', 'work-orders/board', advisorToken).expect(200)).body.data
    expect(JSON.stringify(workshopBoard)).not.toContain(woNumber)
  })

  it('washer drives the five-button flow; the WO walks in parallel and only the workshop route closes it out', async () => {
    const woNumber = await makeWashJob('walk')
    await api('post', `wash-jobs/${woNumber}/assign`, advisorToken).send({ washerId }).expect(200)

    // press → [WO status after]
    const presses: [string, string][] = [
      ['WASHING', 'IN_PROGRESS'],
      ['VACUUMING', 'IN_PROGRESS'],
      ['DETAILING', 'IN_PROGRESS'],
      ['QUALITY_CHECK', 'QUALITY_CHECK'],
      ['READY', 'READY_FOR_COLLECTION'],
    ]
    for (const [step, woStatus] of presses) {
      const r = await api('post', `wash-jobs/${woNumber}/step`, washerToken)
        .set('X-Event-Id', randomUUID())
        .send({ step })
        .expect(200)
      expect(r.body.data.currentStep).toBe(step)
      expect(r.body.data.replayed).toBe(false)
      const wo = await prisma.workOrder.findFirst({ where: { woNumber }, select: { status: true } })
      expect(wo!.status).toBe(woStatus)
    }

    const done = (await api('get', `wash-jobs/${woNumber}`, washerToken).expect(200)).body.data
    expect(done.terminal).toBe(true)
    expect(done.completedAt).toBeTruthy()
    expect(done.allowedNextSteps).toEqual([])
    expect(done.stepHistory).toHaveLength(6) // QUEUED + 5 presses
    expect(done.washer.id).toBe(washerId)

    // Collection done → the workshop route closes the wash out (the one
    // forward move it still owns), and the terminal is permanent.
    await api('patch', `work-orders/${woNumber}/status`, advisorToken).send({ status: 'COMPLETED' }).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, advisorToken).send({ status: 'IN_PROGRESS' }).expect(409)

    // The washer's my-today no longer lists the completed job.
    const mine = (await api('get', 'wash-jobs/my-today', washerToken).expect(200)).body.data.items
    expect(mine.some((w: { workOrder: { woNumber: string } }) => w.workOrder.woNumber === woNumber)).toBe(false)
  })

  it('keeps the machines separate: illegal jumps, the workshop wall, and the CANCELLED escape hatch', async () => {
    const woNumber = await makeWashJob('machine')
    await api('post', `wash-jobs/${woNumber}/assign`, advisorToken).send({ washerId }).expect(200)

    // Illegal jump QUEUED → READY: 409 + allowed list.
    const jump = await api('post', `wash-jobs/${woNumber}/step`, washerToken)
      .set('X-Event-Id', randomUUID())
      .send({ step: 'READY' })
      .expect(409)
    expect(jump.body.error.code).toBe('INVALID_WASH_STEP_TRANSITION')
    expect(jump.body.error.details.allowed).toEqual(['WASHING'])

    // The workshop status route cannot drive a wash (only CANCELLED/COMPLETED).
    const wall = await api('patch', `work-orders/${woNumber}/status`, advisorToken)
      .send({ status: 'READY_FOR_COLLECTION' })
      .expect(409)
    expect(wall.body.error.code).toBe('NOT_A_WASH_JOB')
    await api('patch', `work-orders/${woNumber}/status`, advisorToken).send({ status: 'IN_PROGRESS' }).expect(409)

    // The wash route cannot drive a workshop job.
    const workshopWo = await makeWorkshopJob('cross')
    const cross = await api('post', `wash-jobs/${workshopWo}/step`, advisorToken)
      .set('X-Event-Id', randomUUID())
      .send({ step: 'WASHING' })
      .expect(404)
    expect(cross.body.error.code).toBe('WASH_JOB_NOT_FOUND')

    // CANCELLED stays reachable from the workshop route (escape hatch).
    const cancelWo = await makeWashJob('cancel')
    await api('patch', `work-orders/${cancelWo}/status`, advisorToken).send({ status: 'CANCELLED', reason: 'customer left' }).expect(200)

    // Terminal permanence on the wash machine itself.
    await api('post', `wash-jobs/${woNumber}/assign`, advisorToken).send({ washerId }).expect(200)
    await api('post', `wash-jobs/${woNumber}/step`, washerToken).set('X-Event-Id', randomUUID()).send({ step: 'WASHING' }).expect(200)
    for (const s of ['VACUUMING', 'DETAILING', 'QUALITY_CHECK', 'READY']) {
      await api('post', `wash-jobs/${woNumber}/step`, washerToken).set('X-Event-Id', randomUUID()).send({ step: s }).expect(200)
    }
    const again = await api('post', `wash-jobs/${woNumber}/step`, washerToken)
      .set('X-Event-Id', randomUUID())
      .send({ step: 'WASHING' })
      .expect(409)
    expect(again.body.error.code).toBe('WASH_ALREADY_READY')
  })

  it('offline replays are idempotent via X-Event-Id; RBAC: customer 401/403, unassigned washer 403, advisor may press', async () => {
    const woNumber = await makeWashJob('replay')
    await api('post', `wash-jobs/${woNumber}/assign`, advisorToken).send({ washerId }).expect(200)

    // No event id → rejected (client UUIDs are the offline contract).
    await api('post', `wash-jobs/${woNumber}/step`, washerToken).send({ step: 'WASHING' }).expect(400)

    const eventId = randomUUID()
    await api('post', `wash-jobs/${woNumber}/step`, washerToken).set('X-Event-Id', eventId).send({ step: 'WASHING' }).expect(200)
    const before = await prisma.washJob.findFirst({
      where: { workOrder: { woNumber } },
      select: { stepHistory: true, lastStepEventId: true },
    })

    // Same event id → no-op replay, same state, same history.
    const replay = await api('post', `wash-jobs/${woNumber}/step`, washerToken)
      .set('X-Event-Id', eventId)
      .send({ step: 'WASHING' })
      .expect(200)
    expect(replay.body.data.replayed).toBe(true)
    expect(replay.body.data.currentStep).toBe('WASHING')
    const after = await prisma.washJob.findFirst({
      where: { workOrder: { woNumber } },
      select: { stepHistory: true, lastStepEventId: true },
    })
    expect(after!.lastStepEventId).toBe(eventId)
    expect(JSON.stringify(after!.stepHistory)).toBe(JSON.stringify(before!.stepHistory))

    // A DIFFERENT event id advances (the phone came back online).
    await api('post', `wash-jobs/${woNumber}/step`, washerToken).set('X-Event-Id', randomUUID()).send({ step: 'VACUUMING' }).expect(200)

    // RBAC: customer blocked on reads and writes.
    await api('get', 'wash-jobs', customerToken).expect(403)
    await api('post', `wash-jobs/${woNumber}/step`, customerToken).set('X-Event-Id', randomUUID()).send({ step: 'WASHING' }).expect(403)
    await api('get', 'wash-jobs', undefined).expect(401)

    // A washer cannot press someone else's job — a second unassigned wash.
    const other = await makeWashJob('other')
    const notMine = await api('post', `wash-jobs/${other}/step`, washerToken)
      .set('X-Event-Id', randomUUID())
      .send({ step: 'WASHING' })
      .expect(403)
    expect(notMine.body.error.code).toBe('FORBIDDEN')

    // SERVICE_ADVISOR+ may press any job (lenient WASH QC, §15).
    const mine = await makeWashJob('advisor-press')
    await api('post', `wash-jobs/${mine}/step`, advisorToken).set('X-Event-Id', randomUUID()).send({ step: 'WASHING' }).expect(200)
  })
})
