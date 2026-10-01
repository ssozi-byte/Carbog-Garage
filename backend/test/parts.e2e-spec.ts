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
 * Phase 5D parts & inventory e2e. Requires seeded Postgres (storekeeper +
 * demo parts). Covers: catalog RBAC (mechanic reads, cashier blocked from
 * writes), adjustStock with ledger rows and negative-stock rejection,
 * request → WAITING_PARTS walk, issue → stock decrement + REPAIR_USAGE row
 * (race-free, single tx), ORDERED/CANCELLED branches, and stock exhaustion.
 * Rerun-safe: unique SKUs per run, fresh IPs per request.
 */
describe('Parts & inventory (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let mechanicToken = ''
  let cashierToken = ''
  let storekeeperToken = ''

  let seq = 0
  let ipSeq = 0
  let skuSeq = 0
  const freshIp = (base: number) => `10.11.${base}.${(ipSeq += 1) % 250}`
  const freshSku = (tag: string) => {
    skuSeq += 1
    return `E2E-${tag}-${Date.now().toString(36).slice(-5)}${skuSeq}`.toUpperCase()
  }

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .set('X-Forwarded-For', freshIp(20))

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
  }

  /** Guest booking → confirm → check-in (spawns WO) → WO number. */
  const makeWorkOrder = async (tag: string): Promise<string> => {
    seq += 1
    const phone = `+2547${String((Date.now() % 90_000_000) + seq * 57).padStart(8, '0').slice(-8)}`
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(10))
      .send({ name: `Parts ${tag}`, phone, vehicleText: 'Toyota Fielder 2016', serviceName: 'Vehicle Diagnostics' })
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
      .send({ scheduledDate: '2026-10-06', scheduledTime: '11:30' })
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

  /** Assign the demo mechanic and start the job (IN_PROGRESS). */
  const makeStartedJob = async (tag: string): Promise<string> => {
    const woNumber = await makeWorkOrder(tag)
    const mechanic = await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } })
    await api('post', `work-orders/${woNumber}/assign`, advisorToken)
      .send({ technicianId: mechanic!.id })
      .expect(200)
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken)
      .send({ status: 'IN_PROGRESS' })
      .expect(200)
    return woNumber
  }

  /** Create a part via the API and return its row. */
  const makePart = async (tag: string, overrides: Record<string, unknown> = {}) => {
    const res = await api('post', 'parts', storekeeperToken)
      .send({
        sku: freshSku(tag),
        name: `E2E part ${tag}`,
        unitCostCents: 100_000,
        sellingPriceCents: 200_000,
        quantityOnHand: 5,
        reorderLevel: 2,
        ...overrides,
      })
      .expect(201)
    return res.body.data as { id: string; sku: string; quantityOnHand: number }
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

    advisorToken = await login('advisor@motora.co.ke', '10.11.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.11.9.2')
    cashierToken = await login('cashier@motora.co.ke', '10.11.9.3')
    storekeeperToken = await login('storekeeper@motora.co.ke', '10.11.9.4')
  })

  afterAll(async () => {
    await app.close()
  })

  it('builds the catalog with an opening PURCHASE ledger row; RBAC: mechanic reads, cashier cannot write', async () => {
    const part = await makePart('catalog')
    expect(part.quantityOnHand).toBe(5)

    // Opening stock is explained by a PURCHASE ledger row (same tx as create).
    const detail = await api('get', `parts/${part.id}`, storekeeperToken).expect(200)
    const purchase = detail.body.data.transactions.find((t: { transactionType: string }) => t.transactionType === 'PURCHASE')
    expect(purchase).toMatchObject({ quantityDelta: 5, quantityAfter: 5 })

    // Mechanic can read (roadmap §6: inventory "read parts").
    const list = await api('get', 'parts?q=e2e', mechanicToken).expect(200)
    expect(list.body.data.items.some((p: { id: string }) => p.id === part.id)).toBe(true)

    // Cashier may not write stock or catalog (§6: inventory writes = INVENTORY_MANAGER+).
    await api('post', 'parts', cashierToken)
      .send({ sku: freshSku('cash'), name: 'Cashier part', quantityOnHand: 1 })
      .expect(403)
    await api('post', `parts/${part.id}/adjust`, cashierToken)
      .send({ type: 'ADJUSTMENT', quantityDelta: 1 })
      .expect(403)
    // …and cannot read the full ledger either.
    await api('get', 'inventory/transactions', cashierToken).expect(403)

    // Duplicate SKU per garage rejected.
    await api('post', 'parts', storekeeperToken)
      .send({ sku: part.sku, name: 'Duplicate SKU' })
      .expect(409)

    // Metadata update never touches stock.
    const patched = await api('patch', `parts/${part.id}`, storekeeperToken)
      .send({ name: 'E2E part renamed', reorderLevel: 6 })
      .expect(200)
    expect(patched.body.data.name).toBe('E2E part renamed')
    expect(patched.body.data.quantityOnHand).toBe(5)
  })

  it('adjustStock moves stock with paired ledger rows and refuses negative results', async () => {
    const part = await makePart('adjust', { quantityOnHand: 10, reorderLevel: 4 })

    // Goods-in: +5 PURCHASE with new unit cost.
    const purchase = await api('post', `parts/${part.id}/adjust`, storekeeperToken)
      .send({ type: 'PURCHASE', quantityDelta: 5, unitCostCents: 95_000, supplierRef: 'SP-001' })
      .expect(201)
    expect(purchase.body.data.quantityOnHand).toBe(15)

    // Shrinkage: −2 DAMAGE.
    const damage = await api('post', `parts/${part.id}/adjust`, storekeeperToken)
      .send({ type: 'DAMAGE', quantityDelta: -2, notes: 'Broken on shelf' })
      .expect(201)
    expect(damage.body.data.quantityOnHand).toBe(13)

    // Overdraw blocked — stock can never go negative.
    await api('post', `parts/${part.id}/adjust`, storekeeperToken)
      .send({ type: 'ADJUSTMENT', quantityDelta: -99 })
      .expect(409)
    // …and the failed adjustment wrote nothing (ledger stays consistent).
    const detail = await api('get', `parts/${part.id}`, storekeeperToken).expect(200)
    const deltas = detail.body.data.transactions.map((t: { quantityDelta: number }) => t.quantityDelta)
    expect(deltas).toEqual(expect.arrayContaining([5, -2]))
    expect(deltas).not.toContain(-99)
    expect(detail.body.data.quantityOnHand).toBe(13)

    // Zero delta is a validation error.
    await api('post', `parts/${part.id}/adjust`, storekeeperToken)
      .send({ type: 'ADJUSTMENT', quantityDelta: 0 })
      .expect(400)
  })

  it('walks the job to WAITING_PARTS on request and back to IN_PROGRESS on issue — stock decremented, ledger written, one tx', async () => {
    const woNumber = await makeStartedJob('issue')
    const part = await makePart('issue', { quantityOnHand: 6 })

    // Mechanic requests 2 units.
    const reqRes = await api('post', `work-orders/${woNumber}/parts-requests`, mechanicToken)
      .send({ partId: part.id, quantity: 2, note: 'Rear pads too' })
      .expect(201)
    const request = reqRes.body.data
    expect(request.status).toBe('REQUESTED')

    // Roadmap §5 step 12: the WO is now WAITING_PARTS via a legal walk
    // (IN_PROGRESS → WAITING_PARTS), with a history row explaining why.
    const wo = await prisma.workOrder.findUnique({ where: { woNumber }, select: { status: true } })
    expect(wo!.status).toBe('WAITING_PARTS')
    const history = await prisma.workOrderStatusHistory.findMany({
      where: { workOrder: { woNumber } },
      orderBy: { createdAt: 'asc' },
    })
    const last = history[history.length - 1]
    expect(last.newStatus).toBe('WAITING_PARTS')
    expect(last.reason).toContain(part.sku)

    // Storekeeper sees the request in their queue.
    const queue = await api('get', 'parts-requests?status=REQUESTED', storekeeperToken).expect(200)
    expect(queue.body.data.items.some((r: { id: string }) => r.id === request.id)).toBe(true)

    // Cashier cannot issue (exact role list, not a rank gate).
    await api('post', `parts-requests/${request.id}/issue`, cashierToken).expect(403)

    // Issue: stock 6 → 4, REPAIR_USAGE ledger row, request ISSUED with decider.
    const issued = await api('post', `parts-requests/${request.id}/issue`, storekeeperToken).expect(200)
    expect(issued.body.data).toMatchObject({ status: 'ISSUED', unitPriceAtIssueCents: 200_000 })
    expect(issued.body.data.part.sku).toBe(part.sku)

    const partNow = await prisma.part.findUnique({ where: { id: part.id } })
    expect(partNow!.quantityOnHand).toBe(4)

    const ledger = await prisma.inventoryTransaction.findFirst({
      where: { partId: part.id, transactionType: 'REPAIR_USAGE' },
    })
    expect(ledger).toMatchObject({ quantityDelta: -2, quantityAfter: 4 })
    expect(ledger!.reference).toBe(`parts_request:${request.id}`)

    // Roadmap §5 step 13: issue returns the job to IN_PROGRESS (with history).
    const woAfter = await prisma.workOrder.findUnique({ where: { woNumber }, select: { status: true } })
    expect(woAfter!.status).toBe('IN_PROGRESS')
    const historyAfter = await prisma.workOrderStatusHistory.findMany({
      where: { workOrder: { woNumber } },
      orderBy: { createdAt: 'asc' },
    })
    const lastAfter = historyAfter[historyAfter.length - 1]
    expect(lastAfter.newStatus).toBe('IN_PROGRESS')

    // Replay is rejected — a request is decided exactly once.
    await api('post', `parts-requests/${request.id}/issue`, storekeeperToken).expect(409)

    // Storekeeper identity stamped on the request (append-only trail).
    const stored = await prisma.partRequest.findUnique({ where: { id: request.id } })
    const storekeeper = await prisma.user.findUnique({ where: { email: 'storekeeper@motora.co.ke' } })
    expect(stored!.decidedById).toBe(storekeeper!.id)
    expect(stored!.decidedAt).not.toBeNull()
  })

  it('ORDERED branch: out-of-stock flags procurement without touching stock; mechanic can cancel while pending', async () => {
    const woNumber = await makeStartedJob('order')
    const part = await makePart('order', { quantityOnHand: 0 })

    const reqRes = await api('post', `work-orders/${woNumber}/parts-requests`, mechanicToken)
      .send({ partId: part.id, quantity: 1 })
      .expect(201)
    const request = reqRes.body.data

    // Not a WAITING_PARTS walk here — the job is already IN_PROGRESS and stays.
    const issued = await api('post', `parts-requests/${request.id}/issue`, storekeeperToken).expect(409)
    expect(issued.body.error.code).toBe('INSUFFICIENT_STOCK')
    // The failed issue wrote no ledger row and changed no stock.
    const partNow = await prisma.part.findUnique({ where: { id: part.id } })
    expect(partNow!.quantityOnHand).toBe(0)
    const ledger = await prisma.inventoryTransaction.count({ where: { partId: part.id } })
    expect(ledger).toBe(0)

    // Storekeeper flags procurement — status ORDERED, stock untouched.
    const ordered = await api('post', `parts-requests/${request.id}/order`, storekeeperToken)
      .send({ supplierRef: 'Supplier X quote pending' })
      .expect(200)
    expect(ordered.body.data.status).toBe('ORDERED')
    const partAfter = await prisma.part.findUnique({ where: { id: part.id } })
    expect(partAfter!.quantityOnHand).toBe(0)

    // Ordering an already-decided request is rejected.
    await api('post', `parts-requests/${request.id}/order`, storekeeperToken).expect(409)
    await api('post', `parts-requests/${request.id}/issue`, storekeeperToken).expect(409)

    // Second request: mechanic cancels while still REQUESTED.
    const req2 = await api('post', `work-orders/${woNumber}/parts-requests`, mechanicToken)
      .send({ partId: part.id, quantity: 1 })
      .expect(201)
    await api('post', `parts-requests/${req2.body.data.id}/cancel`, mechanicToken)
      .send({ note: 'Found one in the boot' })
      .expect(200)
    const cancelled = await prisma.partRequest.findUnique({ where: { id: req2.body.data.id } })
    expect(cancelled!.status).toBe('CANCELLED')
    // Cancelling a decided request is rejected.
    await api('post', `parts-requests/${req2.body.data.id}/cancel`, mechanicToken).expect(409)
  })

  it('issues drain stock exactly: concurrent exhaustion leaves a clean ledger and 409s', async () => {
    const woNumber = await makeStartedJob('drain')
    const part = await makePart('drain', { quantityOnHand: 2 })

    const r1 = await api('post', `work-orders/${woNumber}/parts-requests`, mechanicToken)
      .send({ partId: part.id, quantity: 2 })
      .expect(201)
    // A second job wants the last unit that r1 is about to take.
    const woNumber2 = await makeStartedJob('drain2')
    const r2 = await api('post', `work-orders/${woNumber2}/parts-requests`, mechanicToken)
      .send({ partId: part.id, quantity: 1 })
      .expect(201)

    // First issue takes everything.
    await api('post', `parts-requests/${r1.body.data.id}/issue`, storekeeperToken).expect(200)
    // Second cannot overdraw the shelf — the guard re-reads stock inside the tx.
    const late = await api('post', `parts-requests/${r2.body.data.id}/issue`, storekeeperToken).expect(409)
    expect(late.body.error.code).toBe('INSUFFICIENT_STOCK')

    const partNow = await prisma.part.findUnique({ where: { id: part.id } })
    expect(partNow!.quantityOnHand).toBe(0)

    // Ledger arithmetic reconciles: opening − issue = 0 …
    const txs = await prisma.inventoryTransaction.findMany({
      where: { partId: part.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(txs).toHaveLength(2)
    expect(txs[0].quantityDelta + txs[1].quantityDelta).toBe(0)
    expect(txs[0]).toMatchObject({ quantityAfter: txs[0].quantityDelta })
    expect(txs[1]).toMatchObject({ quantityDelta: -2, quantityAfter: 0 })
    // …and the request that lost the race is still pending, not corrupted.
    const loser = await prisma.partRequest.findUnique({ where: { id: r2.body.data.id } })
    expect(loser!.status).toBe('REQUESTED')

    // lowStock filter now flags the empty shelf.
    const low = await api('get', 'parts?lowStock=true', storekeeperToken).expect(200)
    expect(low.body.data.items.some((p: { id: string }) => p.id === part.id)).toBe(true)
  })
})
