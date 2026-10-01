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
 * Staff booking transitions e2e (Phase 4, auth updated in Phase 3).
 * Requires seeded Postgres. Covers: JWT + RBAC on staff routes (401
 * unauthenticated, 403 wrong role), the §2.8 state machine (legal + illegal
 * moves), terminal-status permanence, 404 cross-tenant safety, and
 * persistence of history + audit rows attributed to the real actor.
 */
describe('Bookings — staff transitions (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let advisorId = ''
  let customerToken = ''
  let mechanicToken = ''
  let walkedNumber = '' // booking number from the full-transition walk

  const guest = (body: Record<string, unknown>, ip: string) =>
    request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', ip)
      .send(body)

  const staff = (method: 'get' | 'post' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/bookings${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})

  const login = async (phoneOrEmail: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
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

    advisorToken = await login('advisor@motora.co.ke', '10.2.9.1')
    customerToken = await login('customer@motora.co.ke', '10.2.9.2')
    mechanicToken = await login('mechanic@motora.co.ke', '10.2.9.3')
    const advisor = await prisma.user.findUnique({ where: { email: 'advisor@motora.co.ke' } })
    advisorId = advisor!.id
  })

  afterAll(async () => {
    await app.close()
  })

  // Fresh bookings per scenario. Phones are unique per RUN — the guest
  // endpoint is same-day idempotent per phone, and reruns would otherwise
  // reuse stale booking numbers that drift off the first list page.
  let runSeq = 0
  const make = async (_phone: string, ip: string): Promise<{ number: string; phone: string }> => {
    runSeq += 1
    const phone = `+2547${String((Date.now() % 90_000_000) + runSeq * 7).padStart(8, '0').slice(-8)}`
    const res = await guest(
      { name: 'Transition Test', phone, vehicleText: 'Nissan X-Trail 2017', serviceName: 'Vehicle Diagnostics' },
      ip,
    ).expect(201)
    return { number: res.body.data.bookingNumber as string, phone }
  }

  it('rejects staff endpoints without a token (401)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/bookings').expect(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects staff endpoints for CUSTOMER role (403)', async () => {
    const res = await staff('get', '', customerToken).expect(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('lets MECHANIC view bookings but not transition them (RBAC)', async () => {
    const res = await staff('get', '?limit=5', mechanicToken).expect(200)
    expect(Array.isArray(res.body.data.items)).toBe(true)
    const { number } = await make('+254700300000', '10.2.0.0')
    await staff('post', `/${number}/confirm`, mechanicToken)
      .send({ scheduledDate: '2026-10-01', scheduledTime: '10:30' })
      .expect(403)
  })

  it('lists bookings and shows the created one', async () => {
    const { number, phone } = await make('+254700300001', '10.2.0.1')
    const res = await staff('get', '?limit=50', advisorToken).expect(200)
    const numbers = res.body.data.items.map((b: { bookingNumber: string }) => b.bookingNumber)
    expect(numbers).toContain(number)
    const row = res.body.data.items.find((b: { bookingNumber: string }) => b.bookingNumber === number)
    expect(row.status).toBe('REQUESTED')
    expect(row.customer.phone).toBe(phone)
  })

  it('shows detail with initial history row', async () => {
    const { number } = await make('+254700300002', '10.2.0.2')
    const res = await staff('get', `/${number}`, advisorToken).expect(200)
    expect(res.body.data.bookingNumber).toBe(number)
    expect(res.body.data.statusHistory.map((h: { newStatus: string }) => h.newStatus)).toEqual(['REQUESTED'])
  })

  it('confirms REQUESTED → CONFIRMED with a scheduled slot', async () => {
    const { number } = await make('+254700300003', '10.2.0.3')
    const res = await staff('post', `/${number}/confirm`, advisorToken).send({
      scheduledDate: '2026-10-01',
      scheduledTime: '10:30',
    }).expect(200)
    expect(res.body.data.status).toBe('CONFIRMED')
    expect(res.body.data.scheduledDate).toContain('2026-10-01')
  })

  it('rejects illegal jump REQUESTED → INSPECTION (409 with allowed list)', async () => {
    const { number } = await make('+254700300004', '10.2.0.4')
    const res = await staff('patch', `/${number}/status`, advisorToken).send({ status: 'INSPECTION' }).expect(409)
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION')
    expect(res.body.error.details.allowed).toEqual(['CONFIRMED', 'CANCELLED'])
    // Booking untouched
    const db = await prisma.booking.findUnique({ where: { bookingNumber: number } })
    expect(db?.status).toBe('REQUESTED')
  })

  it('rejects invalid slot format on confirm (400 zod)', async () => {
    const { number } = await make('+254700300005', '10.2.0.5')
    const res = await staff('post', `/${number}/confirm`, advisorToken)
      .send({ scheduledDate: '01-10-2026', scheduledTime: '10am' }).expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('walks CONFIRMED → CHECKED_IN → INSPECTION', async () => {
    const { number } = await make('+254700300006', '10.2.0.6')
    walkedNumber = number
    await staff('post', `/${number}/confirm`, advisorToken).send({ scheduledDate: '2026-10-02', scheduledTime: '09:00' }).expect(200)
    const ci = await staff('post', `/${number}/check-in`, advisorToken).send({}).expect(200)
    expect(ci.body.data.status).toBe('CHECKED_IN')
    const insp = await staff('patch', `/${number}/status`, advisorToken).send({ status: 'INSPECTION' }).expect(200)
    expect(insp.body.data.status).toBe('INSPECTION')
  })

  it('rejects CHECKED_IN → CANCELLED (not a legal transition)', async () => {
    const { number } = await make('+254700300007', '10.2.0.7')
    await staff('post', `/${number}/confirm`, advisorToken).send({ scheduledDate: '2026-10-03', scheduledTime: '08:00' }).expect(200)
    await staff('post', `/${number}/check-in`, advisorToken).send({}).expect(200)
    const res = await staff('post', `/${number}/cancel`, advisorToken).send({ reason: 'customer changed mind' }).expect(409)
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  it('cancels a REQUESTED booking with reason; terminal status is permanent', async () => {
    const { number } = await make('+254700300008', '10.2.0.8')
    const res = await staff('post', `/${number}/cancel`, advisorToken).send({ reason: 'Customer cancelled by phone' }).expect(200)
    expect(res.body.data.status).toBe('CANCELLED')
    expect(res.body.data.cancelledAt).toBeTruthy()

    // Terminal: no further transitions
    const again = await staff('patch', `/${number}/status`, advisorToken).send({ status: 'CONFIRMED' }).expect(409)
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  it('cancelling without a reason fails validation', async () => {
    const { number } = await make('+254700300009', '10.2.0.9')
    const res = await staff('post', `/${number}/cancel`, advisorToken).send({ reason: '' }).expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 404 BOOKING_NOT_FOUND for unknown numbers (no existence leak)', async () => {
    const res = await staff('get', '/MOT-2099-999999', advisorToken).expect(404)
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND')
    await staff('post', '/MOT-2099-999999/confirm', advisorToken)
      .send({ scheduledDate: '2026-10-01', scheduledTime: '10:00' }).expect(404)
  })

  it('exposes the machine-readable transition table', async () => {
    const res = await staff('get', '/status-machine', advisorToken).expect(200)
    const requested = res.body.data.transitions.find((t: { status: string }) => t.status === 'REQUESTED')
    expect(requested.allowed).toEqual(['CONFIRMED', 'CANCELLED'])
    const completed = res.body.data.transitions.find((t: { status: string }) => t.status === 'COMPLETED')
    expect(completed.terminal).toBe(true)
  })

  it('persists full history + audit trail attributed to the advisor', async () => {
    // Exact booking from the walk test (reruns create many per phone)
    const booking = await prisma.booking.findUnique({
      where: { bookingNumber: walkedNumber },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    })
    expect(booking?.status).toBe('INSPECTION')
    expect(booking!.statusHistory.map((h) => h.newStatus)).toEqual([
      'REQUESTED',
      'CONFIRMED',
      'CHECKED_IN',
      'INSPECTION',
    ])
    // Staff-made rows carry the real actor identity (Phase 3)
    for (const h of booking!.statusHistory) {
      if (h.newStatus === 'REQUESTED') {
        expect(h.actor).toBe('SYSTEM')
        expect(h.changedByUserId).toBeNull()
      } else {
        expect(h.actor).toBe('STAFF')
        expect(h.changedByUserId).toBe(advisorId)
      }
    }
    const audit = await prisma.auditLog.findMany({
      where: { resourceType: 'BOOKING', resourceId: booking!.id, action: 'CHANGE_BOOKING_STATUS' },
    })
    expect(audit.length).toBe(3) // confirm, check-in, inspection
    for (const row of audit) {
      expect(row.actorId).toBe(advisorId)
      expect((row.metadata as { via?: string })?.via).toBe('jwt')
    }
  })
})
