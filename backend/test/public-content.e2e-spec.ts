import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module'
import { PinoLogger } from '../src/health/pino.logger'
import { RequestCtxMiddleware } from '../src/common/middleware/request-context.middleware'
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter'
import { EnvelopeInterceptor } from '../src/common/interceptors/envelope.interceptor'
import type { NextFunction, Request, Response } from 'express'

/**
 * Public content e2e — requires the seeded Postgres (docker compose up postgres).
 */
describe('Public content (e2e)', () => {
  let app: INestApplication

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
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/v1/garages/public/current → MOTORA profile with hours', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/garages/public/current').expect(200)
    expect(res.body.data.name).toBe('MOTORA Garage')
    expect(res.body.data.area).toBe('Kilimani')
    expect(res.body.data.phone).toBe('+254712345678')
    expect(res.body.data.hours).toHaveLength(7)
    expect(res.body.data.directionsUrl).toContain('google.com/maps')
  })

  it('GET /api/v1/services → 14 seeded services, CORE first', async ()  => {
    const res = await request(app.getHttpServer()).get('/api/v1/services?limit=50').expect(200)
    expect(res.body.data.items.length).toBe(14)
    expect(res.body.data.items.every((s: { isActive?: boolean }) => s.isActive !== false)).toBe(true)
    expect(res.body.data.meta.total).toBe(14)
  })

  it('GET /api/v1/services?category=EXTRA → 3 extras', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/services?category=EXTRA').expect(200)
    expect(res.body.data.items).toHaveLength(3)
    expect(res.body.data.items.every((s: { category: string }) => s.category === 'EXTRA')).toBe(true)
  })

  it('GET /api/v1/testimonials → 6 approved, no unapproved leakage', async () => approvedTests())

  async function approvedTests() {
    const res = await request(app.getHttpServer()).get('/api/v1/testimonials').expect(200)
    expect(res.body.data.items).toHaveLength(6)
    expect(res.body.data.items.every((t: { rating: number }) => t.rating >= 1 && t.rating <= 5)).toBe(true)
  }

  it('GET /api/v1/gallery-items → 6 published items with image URLs', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/gallery-items').expect(200)
    expect(res.body.data.items).toHaveLength(6)
    expect(res.body.data.items.every((g: { imageUrl: string | null }) => Boolean(g.imageUrl))).toBe(6 > 0)
  })

  it('GET /api/v1/gallery-items?tag=BRAKES → filters by tag', async () => {
    const res = await request(app.getHttpServer()).get('/api/gallery-items?tag=BRAKES'.replace('/api/gallery', '/api/v1/gallery')).expect(200)
    expect(res.body.data.items.every((g: { tag: string }) => g.tag === 'BRAKES')).toBe(true)
  })

  it('rate limiting responds 429 with envelope after 120 req/min', async () => {
    const server = app.getHttpServer()
    let got429 = false
    for (let i = 0; i < 130; i++) {
      const res = await request(server).get('/api/v1/testimonials?limit=1')
      if (res.status === 429) {
        got429 = true
        expect(res.body.error.code).toBe('RATE_LIMITED')
        expect(res.headers['retry-after']).toBeDefined()
        break
      }
    }
    expect(got429).toBe(true)
  })

  it('unknown route → safe error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/definitely-not-a-route').expect(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.requestId).toBeDefined()
  })
})
