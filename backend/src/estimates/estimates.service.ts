import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { NotificationService } from '../comms/notification.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertTransition } from '../work-orders/work-order-state-machine'
import type { Prisma, WorkOrderStatus } from '@prisma/client'
import type { TransitionMeta } from '../bookings/bookings.service'
import { OtpService } from '../auth/otp.service'
import { VAT_RATE_MILLI, lineTotal, vatOn } from '../common/money'
import type { CreateEstimateInput } from './dto/estimate.dto'

// Shared integer money helpers, re-exported for estimate consumers.
export { VAT_RATE_MILLI, lineTotal }
export const estimateVat = vatOn

const CACHE_TTL_MS = 60_000
const DEFAULT_VALID_DAYS = 14

/**
 * Estimates & approvals (Phase 5C, roadmap §4). One estimate per work order;
 * items may trace back to inspection findings; the approval ledger is
 * append-only — every SENT/VIEWED/APPROVED/DECLINED row is permanent history.
 * Totals are always recomputed server-side; client numbers are never trusted.
 */
@Injectable()
export class EstimatesService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly otp: OtpService,
  ) {}

  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  /** Race-free EST-YYYY-NNNNNN from a dedicated Postgres sequence. */
  private async nextEstimateNumber(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<{ nextval: string }[]>(
      `SELECT nextval('estimate_number_seq') as nextval`,
    )
    const n = Number(rows[0]?.nextval ?? 0)
    return `EST-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
  }

  /** Read-time expiry: a SENT estimate past expiresAt is stamped EXPIRED. */
  private async stampExpired(estimate: { id: string; status: string; expiresAt: Date | null }) {
    if (estimate.status === 'SENT' && estimate.expiresAt && estimate.expiresAt < new Date()) {
      await this.prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: 'EXPIRED' },
      })
      return 'EXPIRED'
    }
    return estimate.status
  }

  // ------------------------------------------------------------------
  // Create / read (staff)
  // ------------------------------------------------------------------

  /** Creates (or rebuilds) the work order's DRAFT estimate from priced lines. */
  async create(woNumber: string, input: CreateEstimateInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, status: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    const existing = await this.prisma.estimate.findUnique({ where: { workOrderId: wo.id } })
    if (existing && existing.status !== 'DRAFT') {
      throw new ApiError(
        'INVALID_ESTIMATE_STATE',
        `Estimate ${existing.estimateNumber} is already ${existing.status} — revise it instead of recreating.`,
        409,
      )
    }

    // Every referenced finding must belong to THIS work order (no cross-job leaks).
    const findingIds = [...new Set(input.items.map((i) => i.findingId).filter((v): v is string => !!v))]
    if (findingIds.length > 0) {
      const found = await this.prisma.inspectionFinding.count({
        where: { id: { in: findingIds }, workOrderId: wo.id },
      })
      if (found !== findingIds.length) {
        throw ApiError.validation('One or more findings do not belong to this work order.')
      }
    }
    // Catalog parts must live in THIS garage; partId carries invoice dedupe (5E).
    const partIds = [...new Set(input.items.map((i) => (i as { partId?: string }).partId).filter((v): v is string => !!v))]
    if (partIds.length > 0) {
      const found = await this.prisma.part.count({ where: { id: { in: partIds }, garageId: garage.id } })
      if (found !== partIds.length) {
        throw ApiError.validation('One or more parts do not belong to this garage.')
      }
    }

    const expiresAt = new Date(Date.now() + (input.validDays ?? DEFAULT_VALID_DAYS) * 86_400_000)
    const itemsData = input.items.map((i) => ({
      findingId: i.findingId ?? null,
      partId: (i as { partId?: string }).partId ?? null,
      kind: i.kind,
      description: i.description.slice(0, 300),
      qtyMilli: i.qtyMilli,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: lineTotal(i.qtyMilli, i.unitPriceCents),
    }))
    const subtotal = itemsData.reduce((sum, i) => sum + i.lineTotalCents, 0)
    const vat = vatOn(subtotal)

    const estimate = await this.prisma.$transaction(async (tx) => {
      // One estimate per work order (unique FK). Rebuilding a draft replaces
      // its lines; the ledger keeps any prior staff revision history.
      const row = existing
        ? await tx.estimate.update({
            where: { id: existing.id },
            data: {
              items: { deleteMany: {} },
              subtotalCents: subtotal,
              vatCents: vat,
              totalCents: subtotal + vat,
              expiresAt,
            },
          })
        : await tx.estimate.create({
            data: {
              garageId: garage.id,
              workOrderId: wo.id,
              estimateNumber: await this.nextEstimateNumber(),
              subtotalCents: subtotal,
              vatCents: vat,
              totalCents: subtotal + vat,
              expiresAt,
            },
          })
      await tx.estimateItem.createMany({ data: itemsData.map((i) => ({ ...i, estimateId: row.id })) })
      return row
    })

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'CREATE_ESTIMATE',
          resourceType: 'ESTIMATE',
          resourceId: estimate.id,
          metadata: { woNumber, items: itemsData.length, totalCents: estimate.totalCents, rebuilt: !!existing },
        },
      })
      .catch(() => undefined)

    return this.getForWorkOrder(woNumber)
  }

  /** Staff detail view for a work order: items + approval ledger + expiry stamping. */
  async getForWorkOrder(woNumber: string) {
    const garage = await this.currentGarage()
    const estimate = await this.prisma.estimate.findFirst({
      where: { workOrder: { woNumber }, garageId: garage.id },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: { createdAt: 'asc' } },
        workOrder: { select: { woNumber: true, status: true, customerId: true } },
      },
    })
    if (!estimate) throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    const status = await this.stampExpired(estimate)
    return { ...estimate, status }
  }

  /** Sends the estimate: status SENT + approval row + OTP challenge to the customer's phone. */
  async send(estimateNumber: string, actor: { id: string }, meta: TransitionMeta) {
    const garage = await this.currentGarage()
    const estimate = await this.prisma.estimate.findFirst({
      where: { estimateNumber, garageId: garage.id },
      select: {
        id: true, estimateNumber: true, status: true, totalCents: true, expiresAt: true,
        workOrder: { select: { id: true, woNumber: true, status: true, customer: { select: { phone: true } } } },
        items: { select: { id: true } },
      },
    })
    if (!estimate) throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    if (estimate.items.length === 0) throw new ApiError('ESTIMATE_EMPTY', 'Add at least one item before sending.', 400)
    if (estimate.status !== 'DRAFT') {
      throw new ApiError('INVALID_ESTIMATE_STATE', `Estimate is ${estimate.status}; only DRAFT estimates can be sent.`, 409)
    }

    const customerPhone = estimate.workOrder.customer.phone
    const now = new Date()
    const [updated] = await this.prisma.$transaction([
      this.prisma.estimate.update({
        where: { id: estimate.id },
        data: { status: 'SENT', sentById: actor.id, sentAt: now },
        select: { id: true, estimateNumber: true, status: true, sentAt: true },
      }),
      // Append-only ledger: the send itself is history row #1.
      this.prisma.estimateApproval.create({
        data: {
          estimateId: estimate.id,
          action: 'SENT',
          actorId: actor.id,
          actorType: 'STAFF',
        },
      }),
    ])

    // Walk the WO into the approval-gated state through LEGAL machine moves
    // only (CHECKED_IN → INSPECTION → AWAITING_APPROVAL), recording history
    // for each step. A WO already past approval (IN_PROGRESS…) fails the send.
    let woStatus: WorkOrderStatus = estimate.workOrder.status
    if (woStatus !== 'AWAITING_APPROVAL') {
      for (const step of ['INSPECTION', 'AWAITING_APPROVAL'] as WorkOrderStatus[]) {
        assertTransition(woStatus, step)
        await this.prisma.workOrder.update({
          where: { id: estimate.workOrder.id },
          data: { status: step },
        })
        await this.prisma.workOrderStatusHistory.create({
          data: {
            workOrderId: estimate.workOrder.id,
            oldStatus: woStatus,
            newStatus: step,
            actor: 'STAFF',
            changedByUserId: actor.id,
            reason: step === 'AWAITING_APPROVAL' ? `Estimate ${estimate.estimateNumber} sent` : `Estimate ${estimate.estimateNumber} sent (inspection stage)`,
          },
        })
        woStatus = step
        if (step === 'AWAITING_APPROVAL') break
      }
    }

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'SEND_ESTIMATE',
          resourceType: 'ESTIMATE',
          resourceId: estimate.id,
          requestId: meta.requestId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
          metadata: { estimateNumber, totalCents: estimate.totalCents },
        },
      })
      .catch(() => undefined)

    // Phase 7 (§8): estimate ready → notify the customer (the OTP SMS is the
    // signature channel; the inbox row is the app-side copy).
    await this.notifications
      .record({
        recipientId: (await this.prisma.workOrder.findUnique({
          where: { id: estimate.workOrder.id },
          select: { customerId: true },
        }))!.customerId,
        type: 'ESTIMATE_READY',
        title: `Estimate ${estimate.estimateNumber} is ready`,
        body: 'Your estimate is ready for review and approval — open it to view the details.',
        dedupeKey: `estimate-ready:${estimate.estimateNumber}`,
        workOrderId: estimate.workOrder.id,
        estimateId: estimate.id,
        data: { estimateNumber, woNumber: estimate.workOrder.woNumber, totalCents: estimate.totalCents },
      })
      .catch(() => undefined)

    return { ...updated, customerPhone }
  }

  /**
   * Issues a fresh OTP challenge for a SENT estimate. Ownership is verified
   * against the estimate's customer — never trust a client-supplied phone.
   */
  async requestApprovalCode(estimateNumber: string, phone: string, meta: TransitionMeta) {
    const garage = await this.currentGarage()
    const estimate = await this.prisma.estimate.findFirst({
      where: { estimateNumber, garageId: garage.id },
      select: { id: true, status: true, workOrder: { select: { customer: { select: { phone: true } } } } },
    })
    if (!estimate) throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    if (estimate.status !== 'SENT') {
      throw new ApiError('INVALID_ESTIMATE_STATE', `Estimate is ${estimate.status}; no approval is pending.`, 409)
    }
    return this.otp.requestCode(phone, 'ESTIMATE_APPROVAL', meta, estimate.id)
  }

  /** The customer's view of a SENT estimate (no internal fields). */
  async getForCustomer(estimateNumber: string, phone: string, scopeEstimateId?: string) {
    const garage = await this.currentGarage()
    const estimate = await this.prisma.estimate.findFirst({
      where: { estimateNumber, garageId: garage.id },
      select: {
        id: true, estimateNumber: true, status: true, subtotalCents: true, vatCents: true,
        totalCents: true, expiresAt: true, sentAt: true, decidedAt: true,
        workOrder: {
          select: {
            woNumber: true, vehicleText: true,
            vehicle: { select: { registrationNumber: true, make: true, model: true } },
            customer: { select: { phone: true } },
          },
        },
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, kind: true, description: true, qtyMilli: true,
            unitPriceCents: true, lineTotalCents: true,
            finding: { select: { customerTitle: true, customerExplanation: true, severity: true } },
          },
        },
      },
    })
    if (
      !estimate ||
      (scopeEstimateId !== undefined && estimate.id !== scopeEstimateId) ||
      estimate.workOrder.customer.phone !== phone
    ) {
      throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    }
    const status = await this.stampExpired(estimate)
    // First customer fetch after send = the VIEWED audit event (once per send).
    const viewed = await this.prisma.estimateApproval.findFirst({
      where: { estimateId: estimate.id, action: 'VIEWED' },
      select: { id: true },
    })
    if (!viewed) {
      await this.prisma.estimateApproval.create({
        data: { estimateId: estimate.id, action: 'VIEWED', actorType: 'CUSTOMER' },
      })
    }
    const { workOrder, ...rest } = estimate
    return {
      ...rest,
      status,
      workOrder: { woNumber: workOrder.woNumber, vehicleText: workOrder.vehicleText, vehicle: workOrder.vehicle },
    }
  }

  /** Customer approval (OTP-proven): ledger row + finding flips + WO APPROVED. */
  async approveByOtp(
    estimateNumber: string,
    ctx: { phone: string; scopeEstimateId: string; meta: TransitionMeta },
    input: { note?: string },
  ) {
    const garage = await this.currentGarage()
    const estimate = await this.loadSentForPhone(estimateNumber, ctx.phone, garage.id, ctx.scopeEstimateId)

    const now = new Date()
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.estimate.update({
        where: { id: estimate.id },
        data: { status: 'APPROVED', decidedAt: now },
        select: { id: true, estimateNumber: true, status: true, decidedAt: true },
      })
      await tx.estimateApproval.create({
        data: {
          estimateId: estimate.id,
          action: 'APPROVED',
          actorType: 'CUSTOMER',
          note: input.note?.slice(0, 500),
          otpVerified: true,
          via: 'otp',
        },
      })
      // Every finding covered by this estimate's linked lines is now agreed work.
      await tx.inspectionFinding.updateMany({
        where: { workOrderId: estimate.workOrderId, status: 'SENT', estimateItems: { some: { estimateId: estimate.id } } },
        data: { status: 'APPROVED' },
      })
      // Work order: AWAITING_APPROVAL → APPROVED (legal move in the §3 machine).
      const wo = await tx.workOrder.findUnique({
        where: { id: estimate.workOrderId },
        select: { id: true, status: true, woNumber: true },
      })
      if (wo && wo.status === 'AWAITING_APPROVAL') {
        assertTransition(wo.status, 'APPROVED')
        await tx.workOrder.update({ where: { id: wo.id }, data: { status: 'APPROVED' } })
        await tx.workOrderStatusHistory.create({
          data: {
            workOrderId: wo.id,
            oldStatus: 'AWAITING_APPROVAL',
            newStatus: 'APPROVED',
            actor: 'CUSTOMER',
            reason: `Estimate ${estimate.estimateNumber} approved via OTP`,
          },
        })
      }
      return row
    })

    await this.auditDecision(garage.id, estimate.id, estimate.estimateNumber, 'APPROVED', ctx.meta, input.note)
    // Phase 7 (§8): approval outcomes go to staff — the advisor queue sees it.
    await this.notifyStaffOfDecision(estimate.estimateNumber, 'APPROVED').catch(() => undefined)
    return updated
  }

  /**
   * Customer decline (OTP-proven): never deletes work — every covered finding
   * becomes DEFERRED with the optional followUpAt that feeds reminders (Phase 7).
   */
  async declineByOtp(
    estimateNumber: string,
    ctx: { phone: string; scopeEstimateId: string; meta: TransitionMeta },
    input: { reason: 'TOO_EXPENSIVE' | 'LATER' | 'NEED_INFO' | 'OTHER'; note?: string; followUpAt?: string },
  ) {
    const garage = await this.currentGarage()
    const estimate = await this.loadSentForPhone(estimateNumber, ctx.phone, garage.id, ctx.scopeEstimateId)

    const now = new Date()
    const followUpAt = input.followUpAt ? new Date(input.followUpAt) : null
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.estimate.update({
        where: { id: estimate.id },
        data: { status: 'DECLINED', decidedAt: now },
        select: { id: true, estimateNumber: true, status: true, decidedAt: true },
      })
      await tx.estimateApproval.create({
        data: {
          estimateId: estimate.id,
          action: 'DECLINED',
          actorType: 'CUSTOMER',
          declineReason: input.reason,
          note: input.note?.slice(0, 500),
          otpVerified: true,
          via: 'otp',
        },
      })
      // Declined ≠ deleted: findings persist as DEFERRED (+ follow-up reminder hook).
      await tx.inspectionFinding.updateMany({
        where: { workOrderId: estimate.workOrderId, status: 'SENT', estimateItems: { some: { estimateId: estimate.id } } },
        data: {
          status: 'DEFERRED',
          declineReason: input.reason,
          followUpAt,
        },
      })
      // Work order: back to INSPECTION so staff can re-estimate or proceed.
      const wo = await tx.workOrder.findUnique({
        where: { id: estimate.workOrderId },
        select: { id: true, status: true, woNumber: true },
      })
      if (wo && wo.status === 'AWAITING_APPROVAL') {
        assertTransition(wo.status, 'INSPECTION')
        await tx.workOrder.update({ where: { id: wo.id }, data: { status: 'INSPECTION' } })
        await tx.workOrderStatusHistory.create({
          data: {
            workOrderId: wo.id,
            oldStatus: 'AWAITING_APPROVAL',
            newStatus: 'INSPECTION',
            actor: 'CUSTOMER',
            reason: `Estimate ${estimate.estimateNumber} declined (${input.reason})`,
          },
        })
      }
      return row
    })

    await this.auditDecision(garage.id, estimate.id, estimate.estimateNumber, 'DECLINED', ctx.meta, input.note, input.reason)
    // Phase 7 (§8): declined also lands on the staff queue (re-estimate path).
    await this.notifyStaffOfDecision(estimate.estimateNumber, 'DECLINED', input.reason).catch(() => undefined)
    return updated
  }

  /**
   * Staff-side notify for approval outcomes (§8 "Approved / declined (to
   * staff)"). Best-effort: NEVER fails the decision (one writer, fail-open).
   */
  private async notifyStaffOfDecision(
    estimateNumber: string,
    outcome: 'APPROVED' | 'DECLINED',
    reason?: string,
  ): Promise<void> {
    const staff = await this.prisma.user.findMany({
      where: { garageId: (await this.currentGarage()).id, role: { in: ['SERVICE_ADVISOR', 'ADMIN', 'SUPER_ADMIN'] }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    })
    if (staff.length === 0) return
    await this.notifications.recordManyToRecipients(
      staff.map((s) => s.id),
      {
        dedupeKey: `estimate-${outcome.toLowerCase()}:${estimateNumber}`,
        type: outcome === 'APPROVED' ? 'ESTIMATE_APPROVED' : 'ESTIMATE_DECLINED',
        title: `Estimate ${estimateNumber} ${outcome.toLowerCase()} by customer`,
        body: outcome === 'APPROVED'
          ? 'Customer approved the estimate — the job can start.'
          : `Customer declined the estimate${reason ? ` (${reason.toLowerCase().replace(/_/g, ' ')})` : ''}. Findings were deferred.`,
        data: { estimateNumber, outcome },
      },
    )
  }

  /**
   * Loads a SENT estimate, enforcing ALL of: the OTP token's scope points at
   * this exact estimate, the phone matches the work order's customer, and the
   * offer has not lapsed. A mismatch on any of these is a 404 (§28).
   */
  private async loadSentForPhone(
    estimateNumber: string,
    phone: string,
    garageId: string,
    scopeEstimateId?: string,
  ) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { estimateNumber, garageId },
      select: {
        id: true, estimateNumber: true, status: true, workOrderId: true, expiresAt: true,
        workOrder: { select: { customer: { select: { phone: true } } } },
      },
    })
    // 404 for wrong scope OR wrong phone — never reveal which failed (§28).
    if (!estimate) throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    if (scopeEstimateId !== undefined && estimate.id !== scopeEstimateId) {
      throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    }
    if (estimate.workOrder.customer.phone !== phone) {
      throw ApiError.notFound('ESTIMATE_NOT_FOUND', 'Estimate was not found.')
    }
    // A lapsed SENT offer is stamped EXPIRED here — no decision possible.
    const status = await this.stampExpired(estimate)
    if (status !== 'SENT') {
      throw new ApiError('INVALID_ESTIMATE_STATE', `Estimate is ${status}; no decision is pending.`, 409)
    }
    return estimate
  }

  private async auditDecision(
    garageId: string,
    estimateId: string,
    estimateNumber: string,
    action: 'APPROVED' | 'DECLINED',
    meta: TransitionMeta,
    note?: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          action: `ESTIMATE_${action}`,
          resourceType: 'ESTIMATE',
          resourceId: estimateId,
          requestId: meta.requestId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
          metadata: { estimateNumber, action, reason: reason ?? null, note: note ?? null, via: 'otp' },
        },
      })
      .catch(() => undefined)
  }

  /** Defer-tracking read for the Phase 7 reminders engine. */
  async deferredFollowUps() {
    const garage = await this.currentGarage()
    const rows = await this.prisma.inspectionFinding.findMany({
      where: { garageId: garage.id, status: 'DEFERRED', followUpAt: { not: null } },
      orderBy: { followUpAt: 'asc' },
      select: {
        id: true, customerTitle: true, title: true, severity: true, followUpAt: true,
        declineReason: true, workOrder: { select: { woNumber: true, customerId: true } },
      },
    })
    return { items: rows }
  }
}
