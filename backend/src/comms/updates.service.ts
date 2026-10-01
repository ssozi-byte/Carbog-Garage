import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { clampPagination } from '../common/utils/pagination'
import { TtlCache } from '../common/cache/ttl-cache'
import { NotificationService } from './notification.service'
import type { UpdateAudience } from '@prisma/client'

const CACHE_TTL_MS = 60_000

export const STAFF_ROLES = ['SERVICE_ADVISOR', 'INVENTORY_MANAGER', 'CASHIER', 'ADMIN', 'SUPER_ADMIN'] as const

export interface BroadcastInput {
  audience: UpdateAudience
  title: string
  body: string
  attachmentMediaId?: string
  targetCustomerId?: string
  targetVehicleId?: string
  targetWorkOrderId?: string
}

/** Audience → recipient ids (§28: scoped to THIS garage only). */
async function resolveRecipients(
  prisma: PrismaService,
  garageId: string,
  audience: UpdateAudience,
  customerId?: string,
): Promise<string[]> {
  switch (audience) {
    case 'ALL_CUSTOMERS':
      return (
        await prisma.user.findMany({
          where: { garageId, role: 'CUSTOMER', deletedAt: null, status: { not: 'SUSPENDED' } },
          select: { id: true },
        })
      ).map((u) => u.id)
    case 'SPECIFIC_CUSTOMER':
    case 'SPECIFIC_VEHICLE':
    case 'SPECIFIC_JOB':
      return customerId ? [customerId] : []
    case 'ALL_STAFF':
      return (
        await prisma.user.findMany({
          where: { garageId, role: { in: [...STAFF_ROLES] }, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        })
      ).map((u) => u.id)
    case 'MECHANICS':
      return (
        await prisma.user.findMany({
          where: { garageId, role: 'MECHANIC', deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        })
      ).map((u) => u.id)
    case 'WASHERS':
      return (
        await prisma.user.findMany({
          where: { garageId, role: 'WASHER', deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        })
      ).map((u) => u.id)
  }
}

/**
 * Manager-created customer_updates (roadmap §16/§151). The broadcast row and
 * its fan-out into one Notification row per recipient commit in ONE
 * transaction — "one writer, two triggers": automatic events and manual
 * broadcasts ride the exact same notification pipeline.
 */
@Injectable()
export class UpdatesService {
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

  /** Broadcast history for managers (newest first). */
  async list(page?: number, limit?: number) {
    const garage = await this.currentGarage()
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customerUpdate.findMany({
        where: { garageId: garage.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          sentBy: { select: { firstName: true, lastName: true } },
          attachmentMedia: { select: { id: true, filename: true, mimeType: true } },
        },
      }),
      this.prisma.customerUpdate.count({ where: { garageId: garage.id } }),
    ])
    return {
      items: rows.map((u) => ({
        id: u.id,
        audience: u.audience,
        title: u.title,
        body: u.body,
        attachment: u.attachmentMedia
          ? { id: u.attachmentMedia.id, filename: u.attachmentMedia.filename, mimeType: u.attachmentMedia.mimeType }
          : null,
        targetCustomerId: u.targetCustomerId,
        targetVehicleId: u.targetVehicleId,
        targetWorkOrderId: u.targetWorkOrderId,
        recipientCount: u.recipientCount,
        sentBy: u.sentBy ? `${u.sentBy.firstName} ${u.sentBy.lastName}` : null,
        createdAt: u.createdAt,
      })),
      meta: { page: p, limit: l, total },
    }
  }

  /**
   * Create the broadcast + fan out notifications in one tx. Audience targets:
   *   ALL_CUSTOMERS → every active customer; SPECIFIC_CUSTOMER → that user;
   *   SPECIFIC_VEHICLE → the vehicle's owner; SPECIFIC_JOB → the WO's
   *   customer; ALL_STAFF/MECHANICS/WASHERS → active staff in those roles.
   * Cross-garage targets 404 without existence leaks (§28).
   */
  async broadcast(input: BroadcastInput, sentById: string) {
    const garage = await this.currentGarage()

    // Validate targets up-front (fail before writing anything).
    let customerId: string | undefined
    let vehicleId: string | undefined
    let workOrderId: string | undefined
    if (input.audience === 'SPECIFIC_CUSTOMER' || input.targetCustomerId) {
      const c = await this.prisma.user.findFirst({
        where: { id: input.targetCustomerId, garageId: garage.id, role: 'CUSTOMER', deletedAt: null },
        select: { id: true },
      })
      if (!c) throw ApiError.notFound('CUSTOMER_NOT_FOUND', 'Customer was not found in this garage.')
      customerId = c.id
    }
    if (input.audience === 'SPECIFIC_VEHICLE' || input.targetVehicleId) {
      const v = await this.prisma.vehicle.findFirst({
        where: { id: input.targetVehicleId, garageId: garage.id },
        select: { id: true, customerId: true },
      })
      if (!v) throw ApiError.notFound('VEHICLE_NOT_FOUND', 'Vehicle was not found in this garage.')
      vehicleId = v.id
      customerId = v.customerId
    }
    if (input.audience === 'SPECIFIC_JOB' || input.targetWorkOrderId) {
      const wo = await this.prisma.workOrder.findFirst({
        where: { id: input.targetWorkOrderId, garageId: garage.id },
        select: { id: true, customerId: true },
      })
      if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found in this garage.')
      workOrderId = wo.id
      customerId = wo.customerId
    }

    const recipients = await resolveRecipients(this.prisma, garage.id, input.audience, customerId)
    if (recipients.length === 0) {
      throw new ApiError('UPDATE_NO_RECIPIENTS', 'This broadcast has no recipients in this garage.', 409)
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const update = await tx.customerUpdate.create({
        data: {
          garageId: garage.id,
          audience: input.audience,
          title: input.title,
          body: input.body,
          attachmentMediaId: input.attachmentMediaId,
          targetCustomerId: input.audience === 'SPECIFIC_CUSTOMER' ? customerId : undefined,
          targetVehicleId: input.audience === 'SPECIFIC_VEHICLE' ? vehicleId : undefined,
          targetWorkOrderId: input.audience === 'SPECIFIC_JOB' ? workOrderId : undefined,
          sentById,
          recipientCount: recipients.length,
        },
        select: { id: true, recipientCount: true },
      })
      let deduped = 0
      for (const recipientId of recipients) {
        // WhatsApp rides only for opted-in customers (§8 matrix + consents).
        const profile = await tx.customerProfile.findUnique({
          where: { userId: recipientId },
          select: { marketingOptIn: true },
        })
        const r = await this.notifications.recordManyToRecipients([recipientId], {
          dedupeKey: `customer-update:${update.id}`,
          type: 'MANAGER_UPDATE',
          title: input.title,
          body: input.body,
          data: { sentBy: sentById, audience: input.audience },
          channels: profile?.marketingOptIn ? ['IN_APP', 'PUSH', 'WHATSAPP'] : ['IN_APP', 'PUSH'],
          customerUpdateId: update.id,
          workOrderId,
        })
        deduped += r.deduped
      }
      return { ...update, deduped }
    })

    return {
      id: result.id,
      audience: input.audience,
      title: input.title,
      recipientCount: result.recipientCount,
      deduped: result.deduped,
    }
  }
}
