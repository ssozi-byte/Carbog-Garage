import type { BookingStatus } from '@prisma/client'
import { ApiError } from '../common/errors/error-codes'

/**
 * Booking state machine (docs/database.md §2.8). Any transition not listed
 * here is rejected with INVALID_STATUS_TRANSITION — the backend is the
 * sole authority over booking lifecycle (Spec §11/§30).
 */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CHECKED_IN: ['INSPECTION'],
  INSPECTION: ['AWAITING_APPROVAL', 'IN_PROGRESS', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY_FOR_COLLECTION'],
  READY_FOR_COLLECTION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export const TERMINAL_STATUSES: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError(
      'INVALID_STATUS_TRANSITION',
      `Cannot move a booking from ${from} to ${to}.`,
      409,
      { from, to, allowed: TRANSITIONS[from] ?? [] },
    )
  }
}
