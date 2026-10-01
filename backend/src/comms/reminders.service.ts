import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { clampPagination } from '../common/utils/pagination'
import { TtlCache } from '../common/cache/ttl-cache'
import { NotificationService } from './notification.service'
import type { CreateReminderInput, UpdateReminderInput } from './dto/comms.dto'
import type { ReminderStatus } from '@prisma/client'

const CACHE_TTL_MS = 60_000

/**
 * Service reminders (roadmap §4/§18): maintenance nudges on the vehicle
 * passport. PENDING until due, DUE in the advisor queue, SENT once the
 * reminder notification fires through the one writer, DISMISSED to archive.
 */
@Injectable()
export class RemindersService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  async create(input: CreateReminderInput, actorId: string) {
    const garage = await this.currentGarage()
    // Cross-garage vehicle → 404, never a blind create (§28).
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicleId, garageId: garage.id },
      select: { id: true, customerId: true, registrationNumber: true },
    })
    if (!vehicle) throw ApiError.notFound('VEHICLE_NOT_FOUND', 'Vehicle was not found in this garage.')
    const reminder = await this.prisma.serviceReminder.create({
      data: {
        garageId: garage.id,
        vehicleId: vehicle.id,
        kind: input.kind,
        dueMileage: input.dueMileage,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : undefined,
        title: input.title,
        notes: input.notes,
        createdById: actorId,
      },
    })
    return { id: reminder.id, vehicleId: reminder.vehicleId, status: reminder.status }
  }

  async update(id: string, input: UpdateReminderInput) {
    const garage = await this.currentGarage()
    const reminder = await this.prisma.serviceReminder.findFirst({
      where: { id, garageId: garage.id },
      select: { id: true, status: true },
    })
    if (!reminder) throw ApiError.notFound('REMINDER_NOT_FOUND', 'Service reminder was not found.')
    const updated = await this.prisma.serviceReminder.update({
      where: { id: reminder.id },
      data: {
        ...(input.dueMileage !== undefined ? { dueMileage: input.dueMileage } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    })
    return { id: updated.id, status: updated.status }
  }

  /** Advisor queue: DISMISSED rows are archived, everything else is live. */
  async list(status: string | undefined, page?: number, limit?: number) {
    const garage = await this.currentGarage()
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    const where = {
      garageId: garage.id,
      ...(status ? { status: status as ReminderStatus } : { status: { not: 'DISMISSED' as const } }),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceReminder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        include: {
          vehicle: {
            select: { registrationNumber: true, make: true, model: true, mileage: true, customerId: true },
          },
        },
      }),
      this.prisma.serviceReminder.count({ where }),
    ])
    return { items: rows, meta: { page: p, limit: l, total } }
  }

  /**
   * Send now (or lazily when already DUE): flips the row to SENT and fires
   * the SERVICE_REMINDER notification through the one writer. dedupeKey is
   * the reminder id — sending twice is an idempotent no-op on the inbox.
   */
  async send(id: string, actorId: string) {
    const garage = await this.currentGarage()
    const reminder = await this.prisma.serviceReminder.findFirst({
      where: { id, garageId: garage.id },
      select: {
        id: true, status: true, title: true, dueMileage: true, dueDate: true,
        vehicle: { select: { registrationNumber: true, customer: { select: { id: true } } } },
      },
    })
    if (!reminder) throw ApiError.notFound('REMINDER_NOT_FOUND', 'Service reminder was not found.')
    if (reminder.status === 'SENT') {
      throw new ApiError('REMINDER_ALREADY_SENT', 'This reminder has already been sent.', 409)
    }
    if (reminder.status === 'DISMISSED') {
      throw new ApiError('REMINDER_ALREADY_SENT', 'This reminder was dismissed — create a new one instead.', 409)
    }

    const updated = await this.prisma.serviceReminder.update({
      where: { id: reminder.id },
      data: { status: 'SENT', sentAt: new Date(), sentById: actorId },
      select: { id: true, status: true, sentAt: true },
    })

    const mileage = reminder.dueMileage != null ? ` at ${reminder.dueMileage.toLocaleString('en-KE')} km` : ''
    await this.notifications.record({
      recipientId: reminder.vehicle.customer.id,
      type: 'SERVICE_REMINDER',
      title: `Service due: ${reminder.vehicle.registrationNumber}`,
      body: `${reminder.title}${mileage}. Reply to book a slot.`,
      dedupeKey: `service-reminder:${reminder.id}`,
      data: { reminderId: reminder.id, dueMileage: reminder.dueMileage, dueDate: reminder.dueDate?.toISOString() ?? null },
    })
    return updated
  }
}
