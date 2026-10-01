import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { NotificationService } from '../comms/notification.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertTransition, TERMINAL_STATUSES, TRANSITIONS } from './work-order-state-machine'
import { clampPagination, type PageMeta } from '../common/utils/pagination'
import type { Prisma, WorkOrderStatus, WorkOrderType } from '@prisma/client'
import type { TransitionMeta } from '../bookings/bookings.service'

const CACHE_TTL_MS = 60_000

/**
 * Work orders — the job card (Phase 5A). Spawned from a booking at check-in
 * (see BookingsService.transition); inspections, estimates, parts, QC and
 * the invoice all hang off this record (docs/platform-roadmap-v2.md §2.1).
 */
@Injectable()
export class WorkOrdersService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Single-tenant resolution — same contract as the bookings module. */
  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  /** Race-free WO-YYYY-NNNNNN from the dedicated Postgres sequence. */
  private async nextWoNumber(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<{ nextval: string }[]>(
      `SELECT nextval('wo_number_seq') as nextval`,
    )
    const n = Number(rows[0]?.nextval ?? 0)
    return `WO-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
  }

  /**
   * Creates the job card for a checked-in booking. Called from the bookings
   * transition engine INSIDE its transaction so booking CHECKED_IN and WO
   * creation are atomic. The booking is the source for customer, vehicle,
   * complaint (verbatim) and the requested service.
   */
  async createForBookingTx(
    tx: Prisma.TransactionClient,
    booking: {
      id: string
      garageId: string
      customerId: string
      vehicleId: string | null
      vehicleText: string | null
      serviceId: string | null
      customerNotes: string | null
    },
    actorId: string | undefined,
  ) {
    // Map the requested service to a work-order type; default REPAIR.
    let type: WorkOrderType = 'REPAIR'
    if (booking.serviceId) {
      const svc = await tx.service.findUnique({ where: { id: booking.serviceId }, select: { name: true } })
      if (svc) {
        const n = svc.name.toLowerCase()
        if (n.includes('diagnos')) type = 'DIAGNOSTIC'
        else if (n.includes('wash')) type = 'WASH'
        else if (n.includes('detail')) type = 'DETAILING'
        else if (n.includes('inspection')) type = 'INSPECTION_ONLY'
        else if (n.includes('service') || n.includes('oil')) type = 'SERVICE'
      }
    }

    const wo = await tx.workOrder.create({
      data: {
        garageId: booking.garageId,
        bookingId: booking.id,
        customerId: booking.customerId,
        vehicleId: booking.vehicleId,
        vehicleText: booking.vehicleText,
        woNumber: await this.nextWoNumber(),
        type,
        status: 'CHECKED_IN',
        complaint: booking.customerNotes,
      },
    })

    await tx.workOrderStatusHistory.create({
      data: {
        workOrderId: wo.id,
        oldStatus: null,
        newStatus: 'CHECKED_IN',
        actor: 'SYSTEM',
        reason: 'Work order created at booking check-in',
      },
    })

    // Phase 6 (§2.2): a wash is not a separate system — WASH-type work
    // orders get their ONE wash_jobs row in the same check-in transaction
    // (package = the booking's WASH-category service; step machine QUEUED).
    if (type === 'WASH' && booking.serviceId) {
      await tx.washJob.create({
        data: {
          garageId: booking.garageId,
          workOrderId: wo.id,
          serviceId: booking.serviceId,
          currentStep: 'QUEUED',
          stepHistory: [
            { from: null, to: 'QUEUED', at: new Date().toISOString(), by: actorId ?? null, reason: 'Wash job created at check-in' },
          ],
        },
      })
    }

    // Part of the check-in transaction; failure here rolls everything back,
    // so swallow nothing that matters — but audit loss must not kill check-in.
    await tx.auditLog
      .create({
        data: {
          garageId: booking.garageId,
          actorId,
          action: 'CREATE_WORK_ORDER',
          resourceType: 'WORK_ORDER',
          resourceId: wo.id,
          metadata: { woNumber: wo.woNumber, bookingId: booking.id, via: actorId ? 'jwt' : 'system' },
        },
      })
      .catch(() => undefined)

    return wo
  }

  // ------------------------------------------------------------------
  // Reads — board (manager), my-today (mechanic/washer), detail, list
  // ------------------------------------------------------------------

  /** Live workshop/wash board grouped by status (open work orders). */
  async board(type: WorkOrderType[], statuses?: WorkOrderStatus[]) {
    const garage = await this.currentGarage()
    const where: Prisma.WorkOrderWhereInput = {
      garageId: garage.id,
      type: { in: type },
      status: statuses?.length ? { in: statuses } : { notIn: TERMINAL_STATUSES },
    }
    const rows = await this.prisma.workOrder.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, woNumber: true, status: true, priority: true, type: true,
        bayLabel: true, vehicleText: true, createdAt: true, startedAt: true,
        vehicle: { select: { registrationNumber: true, make: true, model: true } },
        customer: { select: { firstName: true, lastName: true } },
        technician: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    return { items: rows }
  }

  /** The signed-in technician's open jobs (mobile "Today" screen). */
  async myToday(technicianId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: technicianId, deletedAt: null },
      select: { garageId: true },
    })
    if (!user) throw ApiError.notFound('NOT_FOUND', 'User not found.')

    const rows = await this.prisma.workOrder.findMany({
      where: {
        garageId: user.garageId,
        assignedTechnicianId: technicianId,
        status: { notIn: TERMINAL_STATUSES },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true, woNumber: true, status: true, priority: true, type: true,
        vehicleText: true, bayLabel: true, complaint: true, createdAt: true,
        vehicle: { select: { registrationNumber: true, make: true, model: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    })
    const completedToday = await this.prisma.workOrder.count({
      where: {
        garageId: user.garageId,
        assignedTechnicianId: technicianId,
        status: 'COMPLETED',
        completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    })
    return { items: rows, completedToday }
  }

  /** Garage-scoped detail incl. full status history. */
  async getByNumber(woNumber: string) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        vehicle: { select: { registrationNumber: true, make: true, model: true, year: true, mileage: true } },
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        technician: { select: { id: true, firstName: true, lastName: true } },
        booking: { select: { bookingNumber: true, requestedServiceName: true } },
      },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')
    return wo
  }

  /** Paginated list with optional status/technician filters. */
  async list(page = 1, limit = 20, status?: WorkOrderStatus, technicianId?: string) {
    const garage = await this.currentGarage()
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    const where: Prisma.WorkOrderWhereInput = {
      garageId: garage.id,
      ...(status ? { status } : {}),
      ...(technicianId ? { assignedTechnicianId: technicianId } : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.workOrder.count({ where }),
      this.prisma.workOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, woNumber: true, status: true, priority: true, type: true,
          vehicleText: true, bayLabel: true, createdAt: true,
          vehicle: { select: { registrationNumber: true, make: true, model: true } },
          customer: { select: { firstName: true, lastName: true } },
          technician: { select: { firstName: true, lastName: true } },
        },
      }),
    ])
    return { items: rows, meta: { page: p, limit: l, total } satisfies PageMeta }
  }

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------

  /**
   * Generic transition — validates against the machine, appends history
   * with the JWT actor, stamps started/completed, audits after commit.
   * `startedAt` is refreshed on every IN_PROGRESS entry (latest touch).
   */
  async transition(woNumber: string, to: WorkOrderStatus, meta: TransitionMeta) {
    const garage = await this.currentGarage()

    const result = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { woNumber, garageId: garage.id },
        select: { id: true, status: true, type: true, assignedTechnicianId: true },
      })
      if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

      // MECHANIC/WASHER roles may only move their own assigned orders;
      // SERVICE_ADVISOR+ may move anything (object-level authz, §28).
      if (
        meta.actorRole &&
        ['MECHANIC', 'WASHER'].includes(meta.actorRole) &&
        wo.assignedTechnicianId !== meta.actorId
      ) {
        throw ApiError.forbidden('This job is not assigned to you.')
      }

      // Phase 6 (§2.2): the two machines never bleed into each other — a
      // WASH work order is driven ONLY by POST /wash-jobs/:n/step (which
      // walks the WO itself), so the workshop PATCH route refuses it BEFORE
      // the workshop machine speaks; only the close-outs pass through.
      if (wo.type === 'WASH' && to !== 'CANCELLED' && to !== 'COMPLETED') {
        throw new ApiError('NOT_A_WASH_JOB', 'Washes move through POST /wash-jobs/:woNumber/step; the workshop route only closes them out (COMPLETED/CANCELLED).', 409)
      }

      assertTransition(wo.status, to)

      // Phase 5E QC gate: the collection bay is off-limits until a RECENT
      // quality check is approved (strict types).
      if (to === 'READY_FOR_COLLECTION') {
        const latestQc = await tx.qualityCheck.findFirst({
          where: { workOrderId: wo.id },
          orderBy: { createdAt: 'desc' },
        })
        if (!latestQc || latestQc.approved !== true) {
          throw new ApiError(
            'QC_NOT_APPROVED',
            'Quality check must be approved before the vehicle is ready for collection.',
            409,
          )
        }
      }

      const data: Prisma.WorkOrderUpdateInput = { status: to }
      if (to === 'IN_PROGRESS') data.startedAt = new Date()
      if (to === 'COMPLETED') data.completedAt = new Date()

      const updated = await tx.workOrder.update({
        where: { id: wo.id },
        data,
        select: { id: true, woNumber: true, status: true, startedAt: true, completedAt: true },
      })

      await tx.workOrderStatusHistory.create({
        data: {
          workOrderId: wo.id,
          oldStatus: wo.status,
          newStatus: to,
          actor: meta.actorId ? 'STAFF' : 'SYSTEM',
          changedByUserId: meta.actorId,
          reason: meta.reason,
        },
      })

      return updated
    })

    await this.audit(result.id, result.woNumber, to, meta)
    // Phase 7 (§8): READY_FOR_COLLECTION is the flagship notification — push
    // + SMS + WhatsApp; WORK_STARTED keeps the customer in the loop.
    if (to === 'READY_FOR_COLLECTION' || to === 'IN_PROGRESS' || to === 'WORK_COMPLETED_SAFE_GUARD') {
      const cust = await this.prisma.workOrder.findUnique({
        where: { id: result.id },
        select: { customerId: true },
      })
      if (cust && (to !== 'WORK_COMPLETED_SAFE_GUARD')) {
        await this.notifications
          .record({
            recipientId: cust.customerId,
            type: to === 'READY_FOR_COLLECTION' ? 'READY_FOR_COLLECTION' : 'WORK_STARTED',
            title: to === 'READY_FOR_COLLECTION'
              ? `Vehicle ready for collection — ${result.woNumber}`
              : `Work has started — ${result.woNumber}`,
            body: to === 'READY_FOR_COLLECTION'
              ? 'Your vehicle is ready! Pass by the garage to collect it.'
              : 'The technician has started work on your vehicle.',
            dedupeKey: `wo-${to.toLowerCase()}:${result.id}`,
            workOrderId: result.id,
            data: { woNumber: result.woNumber },
          })
          .catch(() => undefined)
      }
    }
    return result
  }

  /** Assign (or reassign) a technician — 404 cross-garage, never a blind update. */
  async assign(woNumber: string, technicianId: string, meta: TransitionMeta) {
    const garage = await this.currentGarage()

    const tech = await this.prisma.user.findFirst({
      where: {
        id: technicianId,
        garageId: garage.id,
        role: { in: ['MECHANIC', 'SERVICE_ADVISOR'] },
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    if (!tech) throw ApiError.notFound('NOT_FOUND', 'Technician was not found in this garage.')

    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, status: true, assignedTechnicianId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    const updated = await this.prisma.workOrder.update({
      where: { id: wo.id },
      data: { assignedTechnicianId: tech.id },
      select: { id: true, woNumber: true, status: true, assignedTechnicianId: true },
    })

    // Same-status history row records the assignment itself.
    await this.prisma.workOrderStatusHistory.create({
      data: {
        workOrderId: wo.id,
        oldStatus: wo.status,
        newStatus: wo.status,
        actor: meta.actorId ? 'STAFF' : 'SYSTEM',
        changedByUserId: meta.actorId,
        reason: 'Technician assigned',
      },
    })

    await this.audit(wo.id, wo.woNumber, wo.status, meta, { technicianId: tech.id })
    return updated
  }

  /** Machine-readable transition table for staff UIs. */
  allowedTransitions() {
    const ALL: WorkOrderStatus[] = [
      'PENDING', 'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL', 'APPROVED',
      'IN_PROGRESS', 'WAITING_PARTS', 'TESTING', 'QUALITY_CHECK',
      'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW',
    ]
    return ALL.map((status) => ({
      status,
      allowed: TRANSITIONS[status] ?? [],
      terminal: TERMINAL_STATUSES.includes(status),
    }))
  }

  /** Best-effort audit write — never fails the operation (§37). */
  private async audit(
    woId: string,
    woNumber: string,
    to: WorkOrderStatus,
    meta: TransitionMeta,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          garageId: (await this.currentGarage()).id,
          actorId: meta.actorId,
          action: 'CHANGE_WORK_ORDER_STATUS',
          resourceType: 'WORK_ORDER',
          resourceId: woId,
          requestId: meta.requestId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
          metadata: { woNumber, newStatus: to, via: meta.actorId ? 'jwt' : 'system', ...extra },
        },
      })
      .catch(() => undefined)
  }
}
