import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { WorkOrdersService } from '../work-orders/work-orders.service'
import { NotificationService } from '../comms/notification.service'
import { ApiError } from '../common/errors/error-codes'
import { normalizeKenyanPhone } from '../common/utils/phone'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertTransition, TERMINAL_STATUSES, TRANSITIONS } from './booking-state-machine'
import { clampPagination, type PageMeta } from '../common/utils/pagination'
import type { Prisma, BookingStatus } from '@prisma/client'
import type { QuoteRequestInput } from './dto/quote-request.dto'

export interface TransitionMeta {
  reason?: string
  scheduledDate?: string
  scheduledTime?: string
  internalNotes?: string
  /** Authenticated staff actor (Phase 3 JWT) — written to history + audit. */
  actorId?: string
  /** Caller's role (e.g. mechanics may only move their own work orders). */
  actorRole?: string
  ip?: string
  userAgent?: string
  requestId?: string
}

const CACHE_TTL_MS = 60_000

@Injectable()
export class BookingsService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly workOrders: WorkOrdersService,
    private readonly notifications: NotificationService,
  ) {}

  /** Single-tenant resolution (M4) — same contract as the public content module. */
  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  /**
   * Guest quote request (Phase 4, M1/M2/M3 bridges):
   *   upsert customer by phone → resolve service by name → create booking
   *   REQUESTED + status history + audit log, all in one transaction.
   */
  async createQuoteRequest(
    input: QuoteRequestInput,
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{ bookingNumber: string; status: string }> {
    const phone = normalizeKenyanPhone(input.phone)
    if (!phone) {
      throw ApiError.validation('Please enter a valid Kenyan phone number, e.g. 0712 345 678 or +254 712 345 678.')
    }

    const garage = await this.currentGarage()
    if (!garage) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')

    // Resolve the requested service by exact name (case-insensitive) against
    // the active catalog; unknown names are still accepted (stored as text).
    let serviceId: string | undefined
    if (input.serviceName) {
      const service = await this.prisma.service.findFirst({
        where: { garageId: garage.id, name: { equals: input.serviceName, mode: 'insensitive' }, isActive: true },
        select: { id: true },
      })
      serviceId = service?.id
    }

    const bookingNumber = await this.nextBookingNumber()

    const booking = await this.prisma.$transaction(async (tx) => {
      // Find-or-create the customer by phone (guest — no password yet).
      const customer = await tx.user.upsert({
        where: { phone },
        update: { deletedAt: null }, // re-engaging a soft-deleted account
        create: {
          garageId: garage.id,
          phone,
          firstName: input.name.split(/\s+/)[0] ?? 'Customer',
          lastName: input.name.split(/\s+/).slice(1).join(' ') || '—',
          role: 'CUSTOMER',
          status: 'PENDING_VERIFICATION',
        },
      })

      // One booking number per customer per day, idempotent-ish re-submit.
      const existing = await tx.booking.findFirst({
        where: {
          customerId: customer.id,
          garageId: garage.id,
          requestedServiceName: input.serviceName ?? null,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: 'REQUESTED',
          vehicleText: input.vehicleText ?? 'Not specified',
        },
        select: { bookingNumber: true, status: true },
      })
      if (existing) {
        return { bookingNumber: existing.bookingNumber, status: existing.status, reused: true }
      }

      const created = await tx.booking.create({
        data: {
          garageId: garage.id,
          customerId: customer.id,
          bookingNumber,
          requestedServiceName: input.serviceName,
          serviceId,
          // CHECK constraint: every booking references a vehicle. The form's
          // vehicle field is optional, so store an explicit placeholder.
          vehicleText: input.vehicleText ?? 'Not specified',
          customerNotes: input.message,
          status: 'REQUESTED',
        },
      })

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: created.id,
          oldStatus: null,
          newStatus: 'REQUESTED',
          actor: 'SYSTEM',
          reason: 'Guest quote request submitted',
        },
      })

      return { ...created, reused: false }
    })

    // Audit outside the tx — best-effort, must not fail the booking.
    if (!(booking as { reused?: boolean }).reused) {
      await this.prisma.auditLog
        .create({
          data: {
            garageId: garage.id,
            action: 'CREATE_BOOKING',
            resourceType: 'BOOKING',
            resourceId: (booking as { id?: string }).id,
            requestId: meta.requestId,
            ipAddress: meta.ip,
            userAgent: meta.userAgent?.slice(0, 255),
            metadata: {
              channel: 'guest_quote_request',
              serviceName: input.serviceName ?? null,
              duplicateSuppressed: false,
            },
          },
        })
        .catch(() => undefined)
    }

    return { bookingNumber: booking.bookingNumber, status: booking.status }
  }

  /** Race-free MOT-YYYY-NNNNNN from a Postgres sequence. */
  private async nextBookingNumber(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<{ nextval: string }[]>(
      `SELECT nextval('booking_number_seq') as nextval`,
    )
    const n = Number(rows[0]?.nextval ?? 0)
    return `MOT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
  }

  // ------------------------------------------------------------------
  // Staff operations (JWT-authenticated; roles enforced by RolesGuard)
  // ------------------------------------------------------------------

  /** Paginated booking list for staff, optionally filtered by status. */
  async listBookings(
    page = 1,
    limit = 20,
    status?: BookingStatus,
  ): Promise<{ items: unknown[]; meta: PageMeta }> {
    const garage = await this.currentGarage()
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    const where: Prisma.BookingWhereInput = { garageId: garage.id, ...(status ? { status } : {}) }

    const [total, rows] = await Promise.all([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          vehicleText: true,
          requestedServiceName: true,
          serviceId: true,
          scheduledDate: true,
          scheduledTime: true,
          customerNotes: true,
          internalNotes: true,
          createdAt: true,
          customer: {
            select: { firstName: true, lastName: true, phone: true, email: true, status: true },
          },
        },
      }),
    ])

    return { items: rows, meta: { page: p, limit: l, total } }
  }

  /** Staff detail view — includes full status history. */
  async getBookingByNumber(bookingNumber: string) {
    const garage = await this.currentGarage()
    const booking = await this.prisma.booking.findFirst({
      where: { bookingNumber, garageId: garage.id },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        customer: {
          select: { firstName: true, lastName: true, phone: true, email: true, status: true, createdAt: true },
        },
      },
    })
    if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'Booking was not found.')
    return booking
  }

  /**
   * Core state-machine transition. Validates against the transition table,
   * then updates booking + appends history in ONE transaction, and writes
   * an audit log after commit. Terminal statuses are permanent (§11).
   */
  async transition(
    bookingNumber: string,
    to: BookingStatus,
    meta: TransitionMeta,
  ) {
    const garage = await this.currentGarage()

    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { bookingNumber, garageId: garage.id },
        select: {
          id: true, garageId: true, customerId: true, vehicleId: true,
          vehicleText: true, serviceId: true, customerNotes: true, status: true,
        },
      })
      // 404 (not 403) — avoids leaking booking existence across tenants (§28).
      if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'Booking was not found.')

      assertTransition(booking.status, to)

      // Phase 5A: checking a vehicle in spawns its work order — the job
      // card — atomically with the booking update (idempotent per booking).
      if (to === 'CHECKED_IN') {
        const existingWo = await tx.workOrder.findUnique({
          where: { bookingId: booking.id },
          select: { id: true },
        })
        if (!existingWo) {
          await this.workOrders.createForBookingTx(tx, booking, meta.actorId)
        }
      }

      const data: Prisma.BookingUpdateInput = { status: to }
      if (to === 'CANCELLED') data.cancelledAt = new Date()
      if (to === 'COMPLETED') data.completedAt = new Date()
      if (meta.internalNotes !== undefined) data.internalNotes = meta.internalNotes

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data,
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          scheduledDate: true,
          scheduledTime: true,
          cancelledAt: true,
          completedAt: true,
        },
      })

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          oldStatus: booking.status,
          newStatus: to,
          actor: 'STAFF',
          changedByUserId: meta.actorId,
          reason: meta.reason,
        },
      })

      return updated
    })

    await this.auditTransition(garage.id, result.id, result.bookingNumber, to, meta)
    // Phase 7 (§8): check-in tells the customer the car is with us; a
    // completed booking tells them the job is closed.
    if (to === 'CHECKED_IN' || to === 'COMPLETED') {
      await this.notifications
        .record({
          recipientId: result.customerId,
          type: to === 'CHECKED_IN' ? 'CHECKED_IN' : 'WORK_COMPLETED',
          title: to === 'CHECKED_IN'
            ? `Booking ${result.bookingNumber} checked in`
            : `Booking ${result.bookingNumber} completed`,
          body: to === 'CHECKED_IN'
            ? 'Your vehicle has been checked in — we will keep you posted as work progresses.'
            : 'The job is complete. Thank you for choosing Motora!',
          dedupeKey: `booking-${to.toLowerCase()}:${result.id}`,
          bookingId: result.id,
          data: { bookingNumber: result.bookingNumber },
        })
        .catch(() => undefined)
    }
    return result
  }

  /** REQUESTED → CONFIRMED with a scheduled slot (staff confirms time). */
  async confirm(bookingNumber: string, meta: TransitionMeta) {
    const garage = await this.currentGarage()

    const result = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { bookingNumber, garageId: garage.id },
        select: { id: true, status: true },
      })
      if (!booking) throw ApiError.notFound('BOOKING_NOT_FOUND', 'Booking was not found.')
      assertTransition(booking.status, 'CONFIRMED')

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CONFIRMED',
          scheduledDate: new Date(`${meta.scheduledDate}T00:00:00Z`),
          scheduledTime: new Date(`2000-01-01T${meta.scheduledTime}:00Z`),
          ...(meta.internalNotes !== undefined ? { internalNotes: meta.internalNotes } : {}),
        },
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          scheduledDate: true,
          scheduledTime: true,
        },
      })

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          oldStatus: booking.status,
          newStatus: 'CONFIRMED',
          actor: 'STAFF',
          changedByUserId: meta.actorId,
          reason: meta.reason ?? 'Slot confirmed by staff',
        },
      })

      return updated
    })

    await this.auditTransition(garage.id, result.id, result.bookingNumber, 'CONFIRMED', meta)
    // Phase 7 (§8): booking confirmed → notify the customer.
    await this.notifications
      .record({
        recipientId: result.customerId,
        type: 'BOOKING_CONFIRMED',
        title: `Booking ${result.bookingNumber} confirmed`,
        body: meta.scheduledDate
          ? `Your slot is booked for ${meta.scheduledDate} at ${meta.scheduledTime ?? 'the scheduled time'}.`
          : 'Your slot is booked — see you then!',
        dedupeKey: `booking-confirmed:${result.id}`,
        bookingId: result.id,
        data: { bookingNumber: result.bookingNumber, scheduledDate: meta.scheduledDate ?? null },
      })
      .catch(() => undefined)
    return result
  }

  /** CONFIRMED → CHECKED_IN (vehicle arrives at the workshop). */
  async checkIn(bookingNumber: string, meta: TransitionMeta) {
    return this.transition(bookingNumber, 'CHECKED_IN', {
      ...meta,
      reason: meta.reason ?? 'Vehicle checked in at workshop',
    })
  }

  /** REQUESTED/CONFIRMED → CANCELLED (staff-initiated; requires reason). */
  async cancel(bookingNumber: string, reason: string, meta: TransitionMeta) {
    return this.transition(bookingNumber, 'CANCELLED', { ...meta, reason })
  }

  /** Best-effort audit write — never fails the operation (§37). */
  private async auditTransition(
    garageId: string,
    bookingId: string,
    bookingNumber: string,
    to: BookingStatus,
    meta: TransitionMeta,
  ): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          actorId: meta.actorId,
          action: 'CHANGE_BOOKING_STATUS',
          resourceType: 'BOOKING',
          resourceId: bookingId,
          requestId: meta.requestId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
          metadata: {
            bookingNumber,
            newStatus: to,
            via: meta.actorId ? 'jwt' : 'system',
            reason: meta.reason ?? null,
          },
        },
      })
      .catch(() => undefined)
  }

  /** Machine-readable view of the transition table (for staff UIs). */
  allowedTransitions(): { status: string; allowed: string[]; terminal: boolean }[] {
    const ALL: BookingStatus[] = [
      'REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL',
      'APPROVED', 'IN_PROGRESS', 'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW',
    ]
    return ALL.map((status) => ({
      status,
      allowed: TRANSITIONS[status] ?? [],
      terminal: TERMINAL_STATUSES.includes(status),
    }))
  }
}
