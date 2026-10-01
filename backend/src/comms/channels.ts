import type { NotificationChannel, NotificationType } from '@prisma/client'

/**
 * Channels matrix (roadmap §8 "Notification defaults"). IN_APP always fires —
 * the notification row IS the inbox. PUSH/SMS/WHATSAPP record the matrix
 * decision made when the event fired; Phase 8 wires real providers through
 * notification_jobs (docs/database.md §2.25, BullMQ) using these snapshots.
 */
export const CHANNELS_MATRIX: Record<NotificationType, NotificationChannel[]> = {
  BOOKING_CONFIRMED: ['IN_APP', 'PUSH', 'SMS'],
  CHECKED_IN: ['IN_APP', 'PUSH'],
  ESTIMATE_READY: ['IN_APP', 'PUSH', 'SMS'],
  // Approval outcomes go to staff (§8 "Approved / declined (to staff)").
  ESTIMATE_APPROVED: ['IN_APP', 'PUSH'],
  ESTIMATE_DECLINED: ['IN_APP', 'PUSH'],
  WORK_STARTED: ['IN_APP', 'PUSH'],
  WORK_COMPLETED: ['IN_APP', 'PUSH'],
  READY_FOR_COLLECTION: ['IN_APP', 'PUSH', 'SMS', 'WHATSAPP'],
  WASH_READY: ['IN_APP', 'PUSH', 'SMS', 'WHATSAPP'],
  PAYMENT_RECEIPT: ['IN_APP', 'PUSH', 'WHATSAPP'],
  // Manager broadcasts are push-only per §8 "Manager updates (§16)".
  MANAGER_UPDATE: ['IN_APP', 'PUSH'],
  SERVICE_REMINDER: ['IN_APP', 'PUSH', 'SMS'],
}

export function channelsFor(type: NotificationType): NotificationChannel[] {
  return CHANNELS_MATRIX[type] ?? ['IN_APP']
}
