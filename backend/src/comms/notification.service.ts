import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { clampPagination } from '../common/utils/pagination'
import { CHANNELS_MATRIX, channelsFor } from './channels'
import type { NotificationChannel, NotificationType } from '@prisma/client'

export interface RecordNotificationInput {
  recipientId: string
  type: NotificationType
  title: string
  body: string
  /** Unique event key — the same event never writes two rows (offline replays included). */
  dedupeKey: string
  data?: Record<string, unknown>
  /** Overrides the §8 channels matrix when the caller knows better. */
  channels?: NotificationChannel[]
  customerUpdateId?: string
  bookingId?: string
  workOrderId?: string
  estimateId?: string
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
}

/**
 * Phase 7 comms (roadmap §8/§16–18). ONE writer: every notification — auto
 * state event or manager broadcast fan-out — lands through record() /
 * recordManyToRecipients(), so dedupe, channels-matrix stamping and inbox
 * semantics live in exactly one place. Delivery is IN_APP now; PUSH/SMS/
 * WHATSAPP rows carry their channel intent for the Phase 8 provider wiring.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** The §8 channels matrix as data (staff UIs / docs readers). */
  matrix() {
    return { matrix: channelsMatrixView() }
  }

  /**
   * Write one notification. Idempotent on dedupeKey: a P2002 replay returns
   * `deduped: true` and leaves the original row untouched — callers run
   * after their business transaction commits, so replays are cheap no-ops.
   */
  async record(input: RecordNotificationInput): Promise<{ id: string; deduped: boolean }> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          recipientId: input.recipientId,
          type: input.type,
          title: input.title.slice(0, 160),
          body: input.body.slice(0, 500),
          dedupeKey: input.dedupeKey.slice(0, 120),
          channels: input.channels ?? channelsFor(input.type),
          data: (input.data ?? undefined) as never,
          customerUpdateId: input.customerUpdateId,
          bookingId: input.bookingId,
          workOrderId: input.workOrderId,
          estimateId: input.estimateId,
        },
        select: { id: true },
      })
      return { id: row.id, deduped: false }
    } catch (e: unknown) {
      if (isUniqueViolation(e)) return { id: '', deduped: true }
      throw e
    }
  }

  /**
   * Fan-out to many recipients (manager broadcasts, §16/§151): one row per
   * recipient, all committed in ONE transaction alongside the broadcast row
   * written by the caller — never a fire-and-forget queue job. dedupeKey is
   * suffixed per recipient.
   */
  async recordManyToRecipients(
    recipients: string[],
    input: Omit<RecordNotificationInput, 'recipientId' | 'dedupeKey'> & { dedupeKey: string },
  ): Promise<{ count: number; deduped: number }> {
    if (recipients.length === 0) return { count: 0, deduped: 0 }
    const channels = input.channels ?? channelsFor(input.type)
    return this.prisma.$transaction(async (tx) => {
      let count = 0
      let deduped = 0
      for (const recipientId of recipients) {
        try {
          await tx.notification.create({
            data: {
              recipientId,
              type: input.type,
              title: input.title.slice(0, 160),
              body: input.body.slice(0, 500),
              dedupeKey: `${input.dedupeKey.slice(0, 100)}:${recipientId}`,
              channels,
              data: (input.data ?? undefined) as never,
              customerUpdateId: input.customerUpdateId,
              bookingId: input.bookingId,
              workOrderId: input.workOrderId,
              estimateId: input.estimateId,
            },
            select: { id: true },
          })
          count += 1
        } catch (e: unknown) {
          if (isUniqueViolation(e)) {
            deduped += 1
            continue
          }
          throw e
        }
      }
      return { count, deduped }
    })
  }

  /** The signed-in user's inbox — own rows only (§28 object-level scoping). */
  async mine(userId: string, unreadOnly: boolean, page?: number, limit?: number) {
    const { skip, take, page: p, limit: l } = clampPagination(page, limit)
    const where = { recipientId: userId, ...(unreadOnly ? { status: 'UNREAD' as const } : {}) }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
      this.prisma.notification.count({ where }),
    ])
    return { items: rows, meta: { page: p, limit: l, total } }
  }

  /** Mark one of MY notifications read — a foreign id is a 404, not a 403. */
  async markRead(userId: string, id: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id, recipientId: userId },
      select: { id: true, status: true },
    })
    if (!row) throw ApiError.notFound('NOTIFICATION_NOT_FOUND', 'Notification was not found.')
    if (row.status === 'UNREAD') {
      await this.prisma.notification.update({
        where: { id: row.id },
        data: { status: 'READ', readAt: new Date() },
      })
    }
    return { id: row.id, status: 'READ', alreadyRead: row.status !== 'UNREAD' }
  }
}

function channelsMatrixView(): Record<string, NotificationChannel[]> {
  const view: Record<string, NotificationChannel[]> = {}
  for (const [type, channels] of Object.entries(CHANNELS_MATRIX)) {
    view[type] = [...channels]
  }
  return view
}
