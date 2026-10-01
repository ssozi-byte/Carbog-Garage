import type { WorkOrderStatus } from '@prisma/client'
import { ApiError } from '../common/errors/error-codes'

/**
 * Work-order state machine (docs/platform-roadmap-v2.md §3). The backend is
 * the sole authority over a job card's lifecycle — any transition not listed
 * here is rejected with 409 INVALID_STATUS_TRANSITION + allowed list.
 *
 * Difference from the booking machine: WAITING_PARTS loops back to
 * IN_PROGRESS, TESTING precedes QUALITY_CHECK, and QC approval is the gate
 * to READY_FOR_COLLECTION (implemented in the service, which requires an
 * approved quality check for REPAIR/SERVICE work orders). A declined
 * estimate sends the job back to INSPECTION (Phase 5C).
 */
export const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PENDING: ['CHECKED_IN', 'CANCELLED'],
  CHECKED_IN: ['INSPECTION', 'IN_PROGRESS', 'CANCELLED'],
  INSPECTION: ['AWAITING_APPROVAL', 'IN_PROGRESS', 'CANCELLED'],
  // AWAITING_APPROVAL → INSPECTION: a declined estimate reopens the job for
  // re-estimation (Phase 5C decline loop); findings stay DEFERRED regardless.
  AWAITING_APPROVAL: ['APPROVED', 'INSPECTION', 'IN_PROGRESS', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'TESTING', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  TESTING: ['QUALITY_CHECK', 'IN_PROGRESS', 'CANCELLED'],
  QUALITY_CHECK: ['READY_FOR_COLLECTION', 'IN_PROGRESS'],
  READY_FOR_COLLECTION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export const TERMINAL_STATUSES: WorkOrderStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

/** Statuses where the work order no longer accepts inspection/parts writes. */
export const CLOSED_STATUSES: WorkOrderStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError(
      'INVALID_STATUS_TRANSITION',
      `Cannot move a work order from ${from} to ${to}.`,
      409,
      { from, to, allowed: TRANSITIONS[from] ?? [] },
    )
  }
}
