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
 * Phase 5E invoicing & payments e2e (roadmap step 16, database.md §2.16–19).
 * Full 5A→5E chain per test: booking → WO → estimate → approve → invoice →
 * QC → READY. Covers: compose from APPROVED estimate + issued parts with
 * dedupe and snapshots, RBAC (mechanic blocked, cashier+ allowed), issue/
 * void, integer totals, CASH payments driving PARTIALLY_PAID → PAID,
 * overpay/idempotency guards, reversal, and the MPESA fail-closed path with
 * the full callback loop (success + replay + failure). Rerun-safe.
 */
describe('Invoices & payments (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let advisorToken = ''
  let mechanicToken = ''
  let cashierToken = ''
  let storekeeperToken = ''

  let seq = 0
  let ipSeq = 0
  let skuSeq = 0
  const freshIp = (base: number) => `10.13.${base}.${(ipSeq += 1) % 250}`
  const freshSku = (tag: string) => `INV-${tag}-${Date.now().toString(36).slice(-5)}${(skuSeq += 1)}`.toUpperCase()

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .set('X-Forwarded-For', freshIp(16))

  const login = async (email: string, ip: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phoneOrEmail: email, password: process.env.SEED_PASSWORD ?? 'MotoraDemo#2026' })
      .expect(200)
    return res.body.data.accessToken as string
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

  /**
   * The whole 5A→5E arc: guest booking → WO → assign → estimate → send →
   * OTP approve → parts issued (optional) → QC → READY_FOR_COLLECTION.
   * Returns every handle the invoice tests need.
   */
  const makeInvoicableJob = async (tag: string, opts: { issueParts?: boolean } = {}) => {
    seq += 1
    const phone = `+2547${String((Date.now() % 90_000_000) + seq * 77).padStart(8, '0').slice(-8)}`
    await request(app.getHttpServer())
      .post('/api/v1/bookings/quote-request')
      .set('X-Forwarded-For', freshIp(10))
      .send({ name: `Inv ${tag}`, phone, vehicleText: 'Subaru Forester 2014', serviceName: 'Vehicle Diagnostics' })
      .expect(201)
    const booking = await prisma.booking.findFirst({
      where: { customer: { phone } },
      orderBy: { createdAt: 'desc' },
      select: { bookingNumber: true },
    })
    await api('post', `bookings/${booking!.bookingNumber}/confirm`, advisorToken)
      .send({ scheduledDate: '2026-10-09', scheduledTime: '14:00' })
      .expect(200)
    await api('post', `bookings/${booking!.bookingNumber}/check-in`, advisorToken).send({}).expect(200)
    const wo = await prisma.workOrder.findFirst({
      where: { booking: { bookingNumber: booking!.bookingNumber } },
      select: { id: true, woNumber: true },
    })
    const woNumber = wo!.woNumber
    const mechanic = await prisma.user.findUnique({ where: { email: 'mechanic@motora.co.ke' } })
    await api('post', `work-orders/${woNumber}/assign`, advisorToken).send({ technicianId: mechanic!.id }).expect(200)

    // Estimate BEFORE work starts: send walks CHECKED_IN → AWAITING_APPROVAL.
    // 4,500 brake pads + 0.5h labour → subtotal 550000, VAT 88000, total 638000.
    const est = await api('post', `work-orders/${woNumber}/estimates`, advisorToken)
      .send({
        items: [
          { kind: 'PART', description: 'Front brake pads (set)', qtyMilli: 1000, unitPriceCents: 450_000 },
          { kind: 'LABOUR', description: 'Brake service labour (0.5h)', qtyMilli: 500, unitPriceCents: 200_000 },
        ],
      })
      .expect(201)
    const estimateNumber = est.body.data.estimateNumber as string
    await api('post', `estimates/${estimateNumber}/send`, advisorToken)
      .set('X-Forwarded-For', freshIp(50))
      .expect(200)
    const otp = await api('post', `estimates/${estimateNumber}/otp-request`, undefined)
      .send({ phone })
      .expect(200)
    const devCode = otp.body.data.devCode as string
    await api('post', `estimates/${estimateNumber}/approve`, undefined)
      .send({ phone, code: devCode })
      .expect(200)

    // Work starts on the approved job (APPROVED → IN_PROGRESS).
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'IN_PROGRESS' }).expect(200)

    let issuedRequestIds: string[] = []
    if (opts.issueParts) {
      const part = await api('post', 'parts', storekeeperToken)
        .send({ sku: freshSku(tag), name: `Extra part ${tag}`, unitCostCents: 50_000, sellingPriceCents: 90_000, quantityOnHand: 3 })
        .expect(201)
      const pr = await api('post', `work-orders/${woNumber}/parts-requests`, mechanicToken)
        .send({ partId: part.body.data.id, quantity: 2 })
        .expect(201)
      // The job is WAITING_PARTS; the walk back happens on issue.
      await api('post', `parts-requests/${pr.body.data.id}/issue`, storekeeperToken).expect(200)
      issuedRequestIds = [pr.body.data.id as string]
      // Resume to IN_PROGRESS happened; walk to TESTING for QC.
    }
    await api('patch', `work-orders/${woNumber}/status`, mechanicToken).send({ status: 'TESTING' }).expect(200)
    const qc = await api('post', `work-orders/${woNumber}/submit-qc`, mechanicToken).send(fullChecklist).expect(200)
    await api('post', `quality-checks/${qc.body.data.id}/approve`, advisorToken).send({}).expect(200)
    await api('patch', `work-orders/${woNumber}/status`, advisorToken).send({ status: 'READY_FOR_COLLECTION' }).expect(200)

    return { woNumber, phone, estimateNumber, issuedRequestIds }
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

    advisorToken = await login('advisor@motora.co.ke', '10.13.9.1')
    mechanicToken = await login('mechanic@motora.co.ke', '10.13.9.2')
    cashierToken = await login('cashier@motora.co.ke', '10.13.9.3')
    storekeeperToken = await login('storekeeper@motora.co.ke', '10.13.9.4')
  })

  afterAll(async () => {
    await app.close()
  })

  it('composes from the APPROVED estimate with snapshots and integer math; RBAC: mechanic blocked, cashier+ allowed', async () => {
    const { woNumber } = await makeInvoicableJob('compose')

    // Mechanic cannot touch invoices (§6: financials = CASHIER+).
    await api('post', `work-orders/${woNumber}/invoice`, mechanicToken).send({}).expect(403)
    await api('get', `work-orders/${woNumber}/invoice`, mechanicToken).expect(403)

    const res = await api('post', `work-orders/${woNumber}/invoice`, cashierToken)
      .send({ discountCents: 50_000 })
      .expect(200)
    const inv = res.body.data
    expect(inv.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(inv.status).toBe('DRAFT')
    // subtotal 550000 − per-line discount 50000 = 500000; VAT 16% = 80000; total 580000.
    expect(inv.subtotalCents).toBe(500_000)
    expect(inv.taxCents).toBe(80_000)
    expect(inv.totalCents).toBe(580_000)
    expect(inv.items).toHaveLength(2)
    // Prices are snapshots (the estimate line's price carried over).
    expect(inv.items[0]).toMatchObject({ itemType: 'PART', unitPriceCents: 450_000, totalCents: 400_000 })

    // Recompose while DRAFT replaces lines and totals.
    const recomposed = await api('post', `work-orders/${woNumber}/invoice`, cashierToken)
      .send({})
      .expect(200)
    expect(recomposed.body.data.invoiceNumber).toBe(inv.invoiceNumber)
    expect(recomposed.body.data.totalCents).toBe(638_000)

    // Compose without an APPROVED estimate is blocked.
    const { woNumber: bare } = await makeInvoicableJob('bare')
    await prisma.estimate.updateMany({
      where: { workOrder: { woNumber: bare } },
      data: { status: 'SENT' },
    })
    await api('post', `work-orders/${bare}/invoice`, cashierToken)
      .send({})
      .expect(409)
    const blocked = await api('post', `work-orders/${bare}/invoice`, cashierToken).send({})
    expect(blocked.body.error.code).toBe('ESTIMATE_NOT_APPROVED')
  })

  it('issued parts add snapshot lines beyond the estimate (deduped per estimate part line)', async () => {
    const { woNumber } = await makeInvoicableJob('parts', { issueParts: true })
    const res = await api('post', `work-orders/${woNumber}/invoice`, cashierToken).send({}).expect(200)
    const inv = res.body.data
    // Estimate lines (638000) + 2 extra units × 90000 snapshot = 180000 → subtotal 730000; VAT 116800; total 846800.
    expect(inv.subtotalCents).toBe(730_000)
    expect(inv.taxCents).toBe(116_800)
    expect(inv.totalCents).toBe(846_800)
    const extra = inv.items.find((i: { itemType: string; estimateItemId?: string | null }) => i.itemType === 'PART' && i.estimateItemId === null)
    expect(extra).toMatchObject({ qtyMilli: 2000, unitPriceCents: 90_000, totalCents: 180_000 })
    expect(extra.partId).not.toBeNull()
  })

  it('issues and voids; void is blocked once money has moved', async () => {
    const { woNumber } = await makeInvoicableJob('issue')
    const inv = (await api('post', `work-orders/${woNumber}/invoice`, cashierToken).send({}).expect(200)).body.data

    // Mechanic cannot issue.
    await api('post', `invoices/${inv.invoiceNumber}/issue`, mechanicToken).expect(403)
    await api('post', `invoices/${inv.invoiceNumber}/issue`, cashierToken).expect(200)
    // Double issue rejected.
    await api('post', `invoices/${inv.invoiceNumber}/issue`, cashierToken).expect(409)

    // Issued invoices cannot be recomposed.
    await api('post', `work-orders/${woNumber}/invoice`, cashierToken).send({}).expect(409)

    // Void before payments works…
    const { woNumber: wo2 } = await makeInvoicableJob('void')
    const inv2 = (await api('post', `work-orders/${wo2}/invoice`, cashierToken).send({}).expect(200)).body.data
    await api('post', `invoices/${inv2.invoiceNumber}/issue`, cashierToken).expect(200)
    const voided = await api('post', `invoices/${inv2.invoiceNumber}/void`, cashierToken)
      .send({ reason: 'Wrong vehicle billed' })
      .expect(200)
    expect(voided.body.data.status).toBe('VOID')

    // …but not once paid.
    const { woNumber: wo3 } = await makeInvoicableJob('voidpaid')
    const inv3 = (await api('post', `work-orders/${wo3}/invoice`, cashierToken).send({}).expect(200)).body.data
    await api('post', `invoices/${inv3.invoiceNumber}/issue`, cashierToken).expect(200)
    await api('post', `invoices/${inv3.invoiceNumber}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 638_000, idempotencyKey: randomUUID() })
      .expect(200)
    const refused = await api('post', `invoices/${inv3.invoiceNumber}/void`, cashierToken)
      .send({ reason: 'Changed my mind' })
      .expect(409)
    expect(refused.body.error.code).toBe('INVALID_INVOICE_STATE')
  })

  it('CASH payments drive PARTIALLY_PAID → PAID; overpay rejected; idempotent replays return the same payment; reversal reopens the balance', async () => {
    const { woNumber } = await makeInvoicableJob('cash')
    const inv = (await api('post', `work-orders/${woNumber}/invoice`, cashierToken).send({}).expect(200)).body.data
    const n = inv.invoiceNumber as string

    // DRAFT invoices take no money.
    await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 100_000, idempotencyKey: randomUUID() })
      .expect(409)

    await api('post', `invoices/${n}/issue`, cashierToken).expect(200)

    // Mechanic cannot take payments.
    await api('post', `invoices/${n}/payments`, mechanicToken)
      .send({ method: 'CASH', amountCents: 100_000, idempotencyKey: randomUUID() })
      .expect(403)

    // Overpay is rejected before anything is written.
    await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 700_000, idempotencyKey: randomUUID() })
      .expect(409)
    expect((await prisma.invoice.findFirst({ where: { invoiceNumber: n } }))!.amountPaidCents).toBe(0)

    // Partial: 300000 → PARTIALLY_PAID, balance 338000.
    const p1 = await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 300_000, idempotencyKey: randomUUID() })
      .expect(200)
    expect(p1.body.data.status).toBe('COMPLETED')
    const afterP1 = (await api('get', `invoices/${n}`, cashierToken).expect(200)).body.data
    expect(afterP1.status).toBe('PARTIALLY_PAID')
    expect(afterP1.balanceDueCents).toBe(338_000)

    // Replay of the SAME idempotency key returns the same row, no double count.
    const replay = await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 300_000, idempotencyKey: p1.body.data.idempotencyKey })
      .expect(200)
    expect(replay.body.data.id).toBe(p1.body.data.id)
    expect((await prisma.invoice.findFirst({ where: { invoiceNumber: n } }))!.amountPaidCents).toBe(300_000)

    // Settle → PAID.
    await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'CASH', amountCents: 338_000, idempotencyKey: randomUUID() })
      .expect(200)
    expect((await api('get', `invoices/${n}`, cashierToken).expect(200)).body.data.status).toBe('PAID')

    // Reverse the second payment → back to PARTIALLY_PAID with balance 338000.
    const payments = (await api('get', `invoices/${n}`, cashierToken).expect(200)).body.data.payments
    const settle = payments.find((p: { amountCents: number }) => p.amountCents === 338_000)
    await api('post', `payments/${settle.id}/reverse`, cashierToken).expect(200)
    const reopened = (await api('get', `invoices/${n}`, cashierToken).expect(200)).body.data
    expect(reopened.status).toBe('PARTIALLY_PAID')
    expect(reopened.balanceDueCents).toBe(338_000)
    const reversal = await prisma.payment.findFirst({ where: { reversesPaymentId: settle.id } })
    expect(reversal).toMatchObject({ status: 'REVERSED', amountCents: 338_000 })

    // Double reversal rejected; settled invoice can no longer be charged.
    await api('post', `payments/${settle.id}/reverse`, cashierToken).expect(409)
  })

  it('MPESA is fail-closed without credentials, but the callback loop works end-to-end (success, replay, failure)', async () => {
    const { woNumber } = await makeInvoicableJob('mpesa')
    const inv = (await api('post', `work-orders/${woNumber}/invoice`, cashierToken).send({}).expect(200)).body.data
    const n = inv.invoiceNumber as string
    await api('post', `invoices/${n}/issue`, cashierToken).expect(200)

    // No MPESA_* env in dev/CI → 503 PAYMENT_PROVIDER_NOT_CONFIGURED.
    const refused = await api('post', `invoices/${n}/payments`, cashierToken)
      .send({ method: 'MPESA', amountCents: 638_000, phoneNumber: '+254712345678' })
      .expect(503)
    expect(refused.body.error.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED')

    // Simulate an initiated Daraja payment (as if configured). Checkout ids and
    // M-Pesa receipts are unique per run — Daraja ids never repeat across runs
    // and receipts live under a partial unique index.
    const checkout1 = `ws_CO_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const checkout2 = `ws_CO_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const receipt = `SIM${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
    const payment = await prisma.payment.create({
      data: {
        garageId: (await prisma.invoice.findFirst({ where: { invoiceNumber: n } }))!.garageId,
        invoiceId: inv.id,
        customerId: inv.customerId,
        amountCents: 638_000,
        method: 'MPESA',
        status: 'PENDING',
        provider: 'DARAJA',
        providerTransactionId: checkout1,
        phoneNumber: '+254712345678',
        idempotencyKey: `sim-${randomUUID()}`,
      },
    })
    await prisma.mpesaRequest.create({
      data: {
        paymentId: payment.id,
        phoneNumber: '+254712345678',
        amountCents: 638_000,
        checkoutRequestId: checkout1,
        status: 'SENT',
      },
    })

    const cb = (checkoutRequestId: string, resultCode: number, receipt?: string) => ({
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: checkoutRequestId,
          ResultCode: resultCode,
          ResultDesc: resultCode === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
          ...(receipt
            ? { CallbackMetadata: { Item: [{ Name: 'Amount', Value: 6380 }, { Name: 'MpesaReceiptNumber', Value: receipt }] } }
            : {}),
        },
      },
    })

    // Success callback → COMPLETED + PAID + receipt stored.
    const ok = await api('post', 'payments/mpesa/callback', undefined)
      .set('Content-Type', 'application/json')
      .send(cb(checkout1, 0, receipt))
      .expect(200)
    expect(ok.body.data.processed).toBe(true)
    const afterOk = (await api('get', `invoices/${n}`, cashierToken).expect(200)).body.data
    expect(afterOk.status).toBe('PAID')
    expect(afterOk.amountPaidCents).toBe(638_000)
    expect((await prisma.payment.findUnique({ where: { id: payment.id } }))!.mpesaReceipt).toBe(receipt)

    // Replay (same CheckoutRequestID) is a cheap reject — no double credit.
    const dupe = await api('post', 'payments/mpesa/callback', undefined)
      .set('Content-Type', 'application/json')
      .send(cb(checkout1, 0, receipt))
      .expect(200)
    expect(dupe.body.data.duplicated).toBe(true)
    expect((await prisma.invoice.findFirst({ where: { invoiceNumber: n } }))!.amountPaidCents).toBe(638_000)
    expect(await prisma.paymentEvent.count({ where: { externalEventId: checkout1 } })).toBe(1)

    // A FAILED callback on a fresh pending payment records the event, marks FAILED, invoice untouched.
    const payment2 = await prisma.payment.create({
      data: {
        garageId: inv.garageId,
        invoiceId: inv.id,
        amountCents: 10_000,
        method: 'MPESA',
        status: 'PENDING',
        provider: 'DARAJA',
        providerTransactionId: checkout2,
        phoneNumber: '+254712345678',
        idempotencyKey: `sim-${randomUUID()}`,
      },
    })
    const fail = await api('post', 'payments/mpesa/callback', undefined)
      .set('Content-Type', 'application/json')
      .send(cb(checkout2, 1032))
      .expect(200)
    expect(fail.body.data.processed).toBe(true)
    expect((await prisma.payment.findUnique({ where: { id: payment2.id } }))!.status).toBe('FAILED')
    expect((await prisma.invoice.findFirst({ where: { invoiceNumber: n } }))!.amountPaidCents).toBe(638_000)

    // Malformed callback → validation error, no event row.
    await api('post', 'payments/mpesa/callback', undefined)
      .set('Content-Type', 'application/json')
      .send({ hello: 'world' })
      .expect(400)
  })
})
