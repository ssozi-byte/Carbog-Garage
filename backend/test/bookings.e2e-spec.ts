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
 * Guest booking quote-request e2e (Phase 4). Requires seeded Postgres.
 * Ordered around the 3-per-10-min rate limit: create → duplicate →
 * invalid → 4th request must be RATE_LIMITED.
 */
describe('Bookings — quote-request (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let bookingNumber = ''

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
  })

  afterAll(async () => {
    // Keep the demo customer/booking (useful seed data), just disconnect.
    await app.close()
  })

  // Distinct IPs per test — the limiter keys on x-forwarded-for, so only
  // the dedicated rate-limit test exercises the 3/10min cap.
  const submit = (body: Record<string, unknown>, ip = '10.0.0.1') =>
    request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', ip)
      .send(body)

  it('creates a guest booking (201, MOT-number, REQUESTED)', async () => {
    const res = await submit({
      name: 'Test Customer',
      phone: '0712 345 999',
      vehicleText: 'Toyota Fielder 2016',
      serviceName: 'Vehicle Diagnostics',
      message: 'Check engine light is on',
    }, '10.0.0.1').expect(201)

    expect(res.body.success).toBe(true)
    expect(res.body.data.bookingNumber).toMatch(/^MOT-\d{4}-\d{6}$/)
    expect(res.body.data.status).toBe('REQUESTED')
    bookingNumber = res.body.data.bookingNumber
  })

  it('normalizes Kenyan phone formats (07xx → +2547xx)', async () => {
    const customer = await prisma.user.findUnique({ where: { phone: '+254712345999' } })
    expect(customer).not.toBeNull()
    expect(customer?.role).toBe('CUSTOMER')
  })

  it('is idempotent for same-day duplicate submissions', async () => {
    const res = await submit({
      name: 'Test Customer',
      phone: '0712 345 999',
      vehicleText: 'Toyota Fielder 2016',
      serviceName: 'Vehicle Diagnostics',
      message: 'Check engine light is on',
    }, '10.0.0.1').expect(201)
    expect(res.body.data.bookingNumber).toBe(bookingNumber)
  })

  it('rejects invalid phone with a safe validation error', async () => {
    // Passes zod length rules but '5' is not a valid KE mobile prefix
    const res = await submit({ name: 'Test', phone: '+254523456789' }, '10.0.0.3').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toMatch(/valid Kenyan phone/i)
  })

  it('rejects payloads missing required fields (zod)', async () => {
    const res = await submit({ phone: '+254712345678' }, '10.0.0.4').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toBeDefined()
  })

  it('enforces the 3-per-10-min rate limit on the 4th request', async () => {
    const body = { name: 'Spammy McSpam', phone: '+254700111222', message: 'again' }
    await submit(body, '10.9.9.9').expect(201)
    await submit(body, '10.9.9.9').expect(201)
    await submit(body, '10.9.9.9').expect(201)
    const res = await submit(body, '10.9.9.9').expect(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('persisted booking with status history and audit log', async () => {
    const booking = await prisma.booking.findUnique({
      where: { bookingNumber },
      include: { statusHistory: true },
    })
    expect(booking).not.toBeNull()
    expect(booking?.status).toBe('REQUESTED')
    expect(booking?.requestedServiceName).toBe('Vehicle Diagnostics')
    expect(booking?.statusHistory.length).toBeGreaterThanOrEqual(1)
    expect(booking?.statusHistory[0].newStatus).toBe('REQUESTED')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'CREATE_BOOKING', resourceType: 'BOOKING', resourceId: booking!.id },
    })
    expect(audit).not.toBeNull()
    expect(audit?.metadata).toMatchObject({ channel: 'guest_quote_request' })
  })

  it('resolved the requested service name against the catalog', async () => {
    const booking = await prisma.booking.findUnique({ where: { bookingNumber } })
    const service = await prisma.service.findFirst({
      where: { name: { equals: 'Vehicle Diagnostics', mode: 'insensitive' } },
    })
    expect(booking?.serviceId).toBe(service?.id)
  })
})
