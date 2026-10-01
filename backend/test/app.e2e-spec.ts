import { Test } from '@nestjs/testing'
import { INestApplication, Controller, Get, Module } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module'
import { PinoLogger } from '../src/health/pino.logger'
import { RequestCtxMiddleware } from '../src/common/middleware/request-context.middleware'
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor'
import { ApiError } from '../src/common/errors/error-codes'

@Controller('boom')
class BoomController {
  @Get()
  boom() {
    throw ApiError.notFound('BOOKING_NOT_FOUND', 'Booking was not found.')
  }
  @Get('unexpected')
  unexpected() {
    throw new Error('secret-internal-detail')
  }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

/**
 * Phase 1 smoke test — boots the real AppModule with no external services
 * and verifies health endpoints, envelopes, error mapping and headers.
 */
describe('Phase 1 — foundation (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, BoomModule],
    })
      .overrideProvider(PinoLogger)
      .useValue({
        init: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        onModuleDestroy: () => undefined,
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
    app.enableCors({
      origin: [cfg.get('FRONTEND_URL', 'http://localhost:5173')],
      credentials: true,
    })

    app.useGlobalInterceptors(new EnvelopeInterceptor())
    app.useGlobalFilters(new GlobalExceptionFilter())

    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health → ok envelope with request id', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.meta.requestId).toBeDefined()
    expect(res.headers['x-request-id']).toBeDefined()
  })

  it('GET /health/live → ok (enveloped)', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200)
    expect(res.body.data.status).toBe('ok')
  })

  it('GET /health/ready → ok with live DB check (enveloped)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(res.body.data.checks.database).toBe('ok')
    expect(res.body.data.checks.dbLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('GET /api/v1/boom → safe error envelope with stable code', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom').expect(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND')
    expect(res.body.error.requestId).toBeDefined()
    expect(res.body.error.message).toBe('Booking was not found.')
  })

  it('GET /api/v1/boom/unexpected → 500 without leaking internals', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/unexpected').expect(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail')
    expect(JSON.stringify(res.body)).not.toContain('stack')
  })

  it('sets security headers (helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })
})
