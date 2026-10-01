import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { lineTotal, vatOn } from '../common/money'
import { MpesaService } from './mpesa.service'
import type { ComposeInvoiceInput, CreatePaymentInput } from './dto/invoice.dto'
import type { Prisma } from '@prisma/client'

const CACHE_TTL_MS = 60_000
/** Chargeable statuses — a DRAFT has not left the building yet. */
const OPEN_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const

interface ComposedLine {
  itemType: 'SERVICE' | 'PART' | 'OTHER'
  description: string
  qtyMilli: number
  unitPriceCents: number
  serviceId?: string
  partId?: string
  estimateItemId?: string
}

/**
 * Invoicing & payments (Phase 5E, roadmap step 16; docs/database.md §2.16–19).
 * The invoice is composed from the work order: the APPROVED estimate's lines
 * (description/kind/qty/price carried over verbatim) plus issued parts
 * snapshot at unitPriceAtIssueCents, deduped per estimate line. Totals are
 * always backend-computed; corrections are VOID/new rows — never edits.
 */
@Injectable()
export class InvoicesService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly mpesa: MpesaService,
  ) {}

  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  /** Race-free INV-YYYY-NNNNNN from a dedicated Postgres sequence. */
  private async nextInvoiceNumber(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<{ nextval: string }[]>(
      `SELECT nextval('invoice_number_seq') as nextval`,
    )
    const n = Number(rows[0]?.nextval ?? 0)
    return `INV-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
  }

  // ------------------------------------------------------------------
  // Composition & lifecycle
  // ------------------------------------------------------------------

  /**
   * Composes (or recomposes, while DRAFT) the work order's invoice from the
   * APPROVED estimate + issued parts (roadmap step 16). Lineage is kept per
   * line: estimateItemId / partId — the paper trail answers "what am I
   * paying for?" without a single float.
   */
  async compose(woNumber: string, input: ComposeInvoiceInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, bookingId: true, customerId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    const estimate = await this.prisma.estimate.findUnique({
      where: { workOrderId: wo.id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    })
    if (!estimate || estimate.status !== 'APPROVED') {
      throw new ApiError(
        'ESTIMATE_NOT_APPROVED',
        'Invoices are composed from an APPROVED estimate — send it and get customer sign-off first.',
        409,
      )
    }

    const issued = await this.prisma.partRequest.findMany({
      where: { workOrderId: wo.id, status: 'ISSUED' },
      orderBy: { updatedAt: 'asc' },
      include: { part: { select: { sku: true, name: true, sellingPriceCents: true } } },
    })

    const lines: ComposedLine[] = []
    for (const item of estimate.items) {
      lines.push({
        itemType: item.kind === 'PART' ? 'PART' : 'SERVICE',
        description: item.description,
        qtyMilli: item.qtyMilli,
        unitPriceCents: item.unitPriceCents,
        estimateItemId: item.id,
      })
    }
    // Dedupe issued parts against priced estimate lines PER PART: an estimate
    // line linked to part X (5C partId, qty in milli) covers the first N
    // units ISSUED of that same part; anything beyond is billed at the
    // issue-time snapshot. Parts the estimate never priced are fully billed.
    const coveredMilli = new Map<string, number>()
    for (const item of estimate.items) {
      if (item.partId) coveredMilli.set(item.partId, (coveredMilli.get(item.partId) ?? 0) + item.qtyMilli)
    }
    for (const req of issued) {
      const needMilli = req.quantity * 1000
      const already = coveredMilli.get(req.partId) ?? 0
      const extraMilli = needMilli - already
      if (already > 0) coveredMilli.set(req.partId, Math.max(0, already - needMilli))
      if (extraMilli <= 0) continue
      lines.push({
        itemType: 'PART',
        description: `${req.part.name} (${req.part.sku}) — issued beyond estimate`,
        qtyMilli: extraMilli,
        unitPriceCents: req.unitPriceAtIssueCents ?? req.part.sellingPriceCents ?? 0,
        partId: req.partId,
      })
    }
    for (const extra of input.extraItems) {
      lines.push({
        itemType: extra.itemType,
        description: extra.description,
        qtyMilli: extra.qtyMilli,
        unitPriceCents: extra.unitPriceCents,
      })
    }
    if (lines.length === 0) {
      throw new ApiError('INVOICE_EMPTY', 'Nothing to invoice — the estimate has no lines.', 400)
    }

    // The discount is a single budget applied down the lines in order (each
    // line absorbs at most its gross); whatever the lines could not absorb
    // comes straight off the subtotal. Never over-discount a line.
    let discountBudget = input.discountCents
    const itemData = lines.map((l) => {
      const gross = lineTotal(l.qtyMilli, l.unitPriceCents)
      const discount = Math.min(discountBudget, gross)
      discountBudget -= discount
      return {
        itemType: l.itemType,
        description: l.description.slice(0, 300),
        qtyMilli: l.qtyMilli,
        unitPriceCents: l.unitPriceCents,
        discountCents: discount,
        taxCents: 0,
        totalCents: gross - discount,
        serviceId: l.serviceId ?? null,
        partId: l.partId ?? null,
        estimateItemId: l.estimateItemId ?? null,
      }
    })
    const absorbedDiscount = input.discountCents - Math.max(0, discountBudget)
    const subtotal = itemData.reduce((sum, i) => sum + i.totalCents, 0)
    const leftoverDiscount = Math.max(0, discountBudget)
    const tax = vatOn(subtotal)
    const total = Math.max(0, subtotal - leftoverDiscount + tax)
    const dueAt = input.dueDays !== undefined ? new Date(Date.now() + input.dueDays * 86_400_000) : null

    const invoice = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { workOrderId: wo.id } })
      if (existing && existing.status !== 'DRAFT') {
        throw new ApiError(
          'INVALID_INVOICE_STATE',
          `Invoice ${existing.invoiceNumber} is ${existing.status}; void it or work from a revision.`,
          409,
        )
      }
      const row = existing
        ? await tx.invoice.update({
            where: { id: existing.id },
            data: {
              items: { deleteMany: {} },
              subtotalCents: subtotal,
              discountCents: absorbedDiscount + leftoverDiscount,
              taxCents: tax,
              totalCents: total,
              dueAt,
            },
          })
        : await tx.invoice.create({
            data: {
              garageId: garage.id,
              workOrderId: wo.id,
              bookingId: wo.bookingId,
              customerId: wo.customerId,
              invoiceNumber: await this.nextInvoiceNumber(),
              subtotalCents: subtotal,
              discountCents: absorbedDiscount + leftoverDiscount,
              taxCents: tax,
              totalCents: total,
              amountPaidCents: 0,
              balanceDueCents: total,
              dueAt,
            },
          })
      await tx.invoiceItem.createMany({ data: itemData.map((i) => ({ ...i, invoiceId: row.id })) })
      return row
    })

    await this.audit(garage.id, actor.id, invoice.status === 'DRAFT' ? 'COMPOSE_INVOICE' : 'RECOMPOSE_INVOICE', invoice.id, {
      woNumber,
      lines: itemData.length,
      totalCents: invoice.totalCents,
    })
    return this.get(invoice.invoiceNumber)
  }

  /** DRAFT → ISSUED (the paper leaves the building; totals frozen). */
  async issue(invoiceNumber: string, actor: { id: string }) {
    const garage = await this.currentGarage()
    const invoice = await this.findInvoice(garage.id, invoiceNumber)
    if (invoice.status !== 'DRAFT') {
      throw new ApiError('INVALID_INVOICE_STATE', `Invoice is ${invoice.status}; only DRAFT invoices can be issued.`, 409)
    }
    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'ISSUED', issuedById: actor.id, issuedAt: new Date() },
    })
    await this.audit(garage.id, actor.id, 'ISSUE_INVOICE', invoice.id, { invoiceNumber })
    return updated
  }

  /** Corrections = VOID + reason. Never deleted, never edited. */
  async void(invoiceNumber: string, input: { reason: string }, actor: { id: string }) {
    const garage = await this.currentGarage()
    const invoice = await this.findInvoice(garage.id, invoiceNumber)
    if (invoice.status === 'VOID') {
      throw new ApiError('INVALID_INVOICE_STATE', 'Invoice is already void.', 409)
    }
    const paid = invoice.amountPaidCents > 0
    if (paid) {
      throw new ApiError(
        'INVALID_INVOICE_STATE',
        'Invoice has payments — reverse them individually before voiding.',
        409,
      )
    }
    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID', voidedAt: new Date(), voidedById: actor.id, voidReason: input.reason },
    })
    await this.audit(garage.id, actor.id, 'VOID_INVOICE', invoice.id, { invoiceNumber, reason: input.reason })
    return updated
  }

  /** Work-order invoice (or 404). */
  async getForWorkOrder(woNumber: string) {
    const garage = await this.currentGarage()
    const invoice = await this.prisma.invoice.findFirst({
      where: { workOrder: { woNumber }, garageId: garage.id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        workOrder: { select: { woNumber: true, status: true } },
      },
    })
    if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice was not found.')
    return invoice
  }

  async get(invoiceNumber: string) {
    const garage = await this.currentGarage()
    const invoice = await this.prisma.invoice.findFirst({
      where: { invoiceNumber, garageId: garage.id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        workOrder: { select: { woNumber: true, status: true } },
      },
    })
    if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice was not found.')
    return invoice
  }

  async list(status?: string) {
    const garage = await this.currentGarage()
    const items = await this.prisma.invoice.findMany({
      where: {
        garageId: garage.id,
        ...(status ? { status: status as (typeof OPEN_INVOICE_STATUSES)[number] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { workOrder: { select: { woNumber: true } } },
    })
    return { items, total: items.length }
  }

  // ------------------------------------------------------------------
  // Payments
  // ------------------------------------------------------------------

  /**
   * Records/initiates a payment against an invoice. CASH (+ CARD/BANK/
   * OTHER) completes immediately at the counter. MPESA creates a PENDING
   * payment and pushes an STK prompt — completion arrives via the Daraja
   * callback. Idempotency: duplicate client keys return the existing payment.
   */
  async createPayment(invoiceNumber: string, input: CreatePaymentInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    const invoice = await this.findInvoice(garage.id, invoiceNumber)
    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) {
      throw new ApiError('INVALID_INVOICE_STATE', `Invoice is ${invoice.status}; it cannot take payments.`, 409)
    }
    if (input.amountCents > invoice.balanceDueCents) {
      throw new ApiError(
        'AMOUNT_EXCEEDS_BALANCE',
        `Balance due is ${invoice.balanceDueCents} cents; cannot take ${input.amountCents}.`,
        409,
      )
    }

    const idempotencyKey = input.idempotencyKey ?? `inv:${invoice.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } })
    if (existing) return existing

    if (input.method === 'MPESA') {
      return this.initiateMpesa(invoice, input, idempotencyKey, actor)
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          garageId: garage.id,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          amountCents: input.amountCents,
          method: input.method,
          status: 'COMPLETED',
          provider: 'MANUAL',
          idempotencyKey,
          initiatedAt: new Date(),
          completedAt: new Date(),
        },
      })
      await this.applyPaymentToInvoice(tx, invoice.id, input.amountCents)
      return row
    })
    await this.audit(garage.id, actor.id, 'PAYMENT_COMPLETED', payment.id, {
      invoiceNumber,
      method: input.method,
      amountCents: input.amountCents,
    })
    return payment
  }

  /** MPESA: PENDING payment + mpesa_requests row + STK push (fail-closed). */
  private async initiateMpesa(
    invoice: { id: string; invoiceNumber: string; customerId: string; balanceDueCents: number },
    input: CreatePaymentInput,
    idempotencyKey: string,
    actor: { id: string },
  ) {
    const garage = await this.currentGarage()
    if (!input.phoneNumber) {
      throw new ApiError('VALIDATION_ERROR', 'phoneNumber is required for MPESA payments.', 400)
    }
    const push = await this.mpesa.stkPush(input.phoneNumber, input.amountCents, invoice.invoiceNumber).catch((e) => {
      if (e instanceof ApiError) throw e
      throw new ApiError('PAYMENT_PROVIDER_ERROR', 'M-Pesa STK push failed.', 502)
    })

    const payment = await this.prisma.payment.create({
      data: {
        garageId: garage.id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents: input.amountCents,
        method: 'MPESA',
        status: 'PENDING',
        provider: 'DARAJA',
        providerTransactionId: push.checkoutRequestId,
        phoneNumber: input.phoneNumber,
        idempotencyKey,
        initiatedAt: new Date(),
      },
    })
    await this.prisma.mpesaRequest.create({
      data: {
        paymentId: payment.id,
        phoneNumber: input.phoneNumber,
        amountCents: input.amountCents,
        merchantRequestId: push.merchantRequestId,
        checkoutRequestId: push.checkoutRequestId,
        status: 'SENT',
      },
    })
    await this.audit(garage.id, actor.id, 'PAYMENT_INITIATED', payment.id, {
      invoiceNumber: invoice.invoiceNumber,
      provider: 'DARAJA',
      simulated: push.simulated,
    })
    return payment
  }

  /**
   * Daraja STK callback (public, x-daraja signature is overkill for dev; the
   * payload hash + UNIQUE (provider, external_event_id) make replays a cheap
   * reject). ResultCode 0 → COMPLETED (+ invoice update); anything else →
   * FAILED. Event rows are ALWAYS recorded, processed or not.
   */
  async handleMpesaCallback(rawBody: string) {
    const payloadHash = createHash('sha256').update(rawBody).digest('hex')
    let parsed: {
      Body?: {
        stkCallback?: {
          MerchantRequestID?: string
          CheckoutRequestID?: string
          ResultCode?: number
          ResultDesc?: string
          CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] }
        }
      }
    }
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw ApiError.validation('Callback body must be JSON.')
    }
    const cb = parsed.Body?.stkCallback
    if (!cb?.CheckoutRequestID) {
      throw ApiError.validation('Callback is missing Body.stkCallback.CheckoutRequestID.')
    }
    const externalEventId = cb.CheckoutRequestID

    // Cheap replay rejection: unique (provider, externalEventId).
    const dupe = await this.prisma.paymentEvent.findUnique({
      where: { provider_externalEventId: { provider: 'DARAJA', externalEventId } },
      select: { id: true },
    })
    if (dupe) {
      return { duplicated: true, processed: false }
    }

    const payment = await this.prisma.payment.findFirst({
      where: { providerTransactionId: externalEventId, provider: 'DARAJA' },
      select: { id: true, status: true, invoiceId: true, amountCents: true },
    })

    const success = cb.ResultCode === 0
    const receipt = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'MpesaReceiptNumber')?.Value

    await this.prisma.paymentEvent.create({
      data: {
        paymentId: payment?.id,
        provider: 'DARAJA',
        eventType: 'STK_CALLBACK',
        externalEventId,
        payloadHash,
        payloadMetadata: {
          resultCode: cb.ResultCode,
          resultDesc: cb.ResultDesc,
          receipt: receipt ?? null,
          amount: cb.CallbackMetadata?.Item?.find((i) => i.Name === 'Amount')?.Value ?? null,
        } as unknown as Prisma.InputJsonValue,
        processed: !!payment && payment.status === 'PENDING',
        processedAt: payment && payment.status === 'PENDING' ? new Date() : null,
      },
    })

    if (!payment) {
      // Unknown checkout id: event stored for reconciliation, nothing to apply.
      return { duplicated: false, processed: false, matched: false, applied: false }
    }
    if (payment.status !== 'PENDING') {
      return { duplicated: false, processed: false, matched: true, applied: false }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: success
          ? { status: 'COMPLETED', completedAt: new Date(), mpesaReceipt: receipt ? String(receipt) : null }
          : { status: 'FAILED', failedAt: new Date() },
      })
      if (success) {
        await this.applyPaymentToInvoice(tx, payment.invoiceId, payment.amountCents)
      }
    })
    await this.prisma.mpesaRequest.updateMany({
      where: { checkoutRequestId: externalEventId },
      data: { status: 'CALLBACK_RECEIVED', resultCode: cb.ResultCode, resultDesc: cb.ResultDesc?.slice(0, 300) },
    })

    const garageId = (await this.prisma.invoice.findUnique({ where: { id: payment.invoiceId }, select: { garageId: true } }))?.garageId
    if (garageId) {
      await this.audit(garageId, null, success ? 'PAYMENT_COMPLETED' : 'PAYMENT_FAILED', payment.id, {
        checkoutRequestId: externalEventId,
        receipt: receipt ?? null,
      })
    }
    return { duplicated: false, processed: true, matched: true, applied: success }
  }

  /** Same math for counter payments and callbacks — one writer. */
  private async applyPaymentToInvoice(
    tx: { invoice: { findUnique: Function; update: Function } },
    invoiceId: string,
    amountCents: number,
  ) {
    const invoice = await (tx.invoice as Prisma.InvoiceDelegate).findUnique({
      where: { id: invoiceId },
      select: { totalCents: true, amountPaidCents: true, status: true },
    })
    if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice was not found.')
    const amountPaid = invoice.amountPaidCents + amountCents
    const balance = Math.max(0, invoice.totalCents - amountPaid)
    await (tx.invoice as Prisma.InvoiceDelegate).update({
      where: { id: invoiceId },
      data: {
        amountPaidCents: amountPaid,
        balanceDueCents: balance,
        status: balance === 0 ? 'PAID' : 'PARTIALLY_PAID',
      },
    })
  }

  /** Reversal: a NEW payment row pointing at the original (never an edit). */
  async reversePayment(paymentId: string, actor: { id: string }) {
    const garage = await this.currentGarage()
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, garageId: garage.id },
      select: { id: true, status: true, invoiceId: true, amountCents: true },
    })
    if (!payment) throw ApiError.notFound('NOT_FOUND', 'Payment was not found.')
    if (payment.status !== 'COMPLETED') {
      throw new ApiError('INVALID_PAYMENT_STATE', 'Only COMPLETED payments can be reversed.', 409)
    }
    const already = await this.prisma.payment.findFirst({
      where: { reversesPaymentId: payment.id },
      select: { id: true },
    })
    if (already) {
      throw new ApiError('INVALID_PAYMENT_STATE', 'Payment has already been reversed.', 409)
    }
    const reversal = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          garageId: garage.id,
          invoiceId: payment.invoiceId,
          amountCents: payment.amountCents,
          method: 'OTHER',
          status: 'REVERSED',
          provider: 'MANUAL',
          reversesPaymentId: payment.id,
          idempotencyKey: `reversal:${payment.id}`,
        },
      })
      const invoice = await tx.invoice.findUnique({
        where: { id: payment.invoiceId },
        select: { totalCents: true, amountPaidCents: true },
      })
      const amountPaid = Math.max(0, (invoice?.amountPaidCents ?? 0) - payment.amountCents)
      const balance = Math.max(0, (invoice?.totalCents ?? 0) - amountPaid)
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          amountPaidCents: amountPaid,
          balanceDueCents: balance,
          status: amountPaid === 0 ? 'ISSUED' : balance === 0 ? 'PAID' : 'PARTIALLY_PAID',
        },
      })
      return row
    })
    await this.audit(garage.id, actor.id, 'PAYMENT_REVERSED', reversal.id, { reverses: payment.id })
    return reversal
  }

  private async findInvoice(garageId: string, invoiceNumber: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { invoiceNumber, garageId },
    })
    if (!invoice) throw ApiError.notFound('INVOICE_NOT_FOUND', 'Invoice was not found.')
    return invoice
  }

  private async audit(
    garageId: string,
    actorId: string | null,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ) {
    const jsonMeta = metadata as { [key: string]: unknown } | undefined
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          actorId: actorId ?? undefined,
          action,
          resourceType: 'INVOICE',
          resourceId,
          metadata: jsonMeta as never,
        },
      })
      .catch(() => undefined)
  }
}
