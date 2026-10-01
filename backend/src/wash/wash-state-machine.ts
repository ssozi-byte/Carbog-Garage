import type { WashStep } from '@prisma/client'
import { ApiError } from '../common/errors/error-codes'

/**
 * Wash step machine (docs/platform-roadmap-v2.md §2.2/§3) — the washer's
 * five-button UI made API. Modeled exactly like the work-order machine
 * (legal-move validation, 409 + allowed list) but stored in a SEPARATE
 * table (wash_jobs) so the two machines never bleed into each other.
 *
 * Forward skips are legal because packages differ: "Exterior Wash" runs
 * WASHING → QUALITY_CHECK → READY with no vacuum/detailing, while "Full
 * Detail Wash" presses every button. QUALITY_CHECK → WASHING is the single
 * recovery edge (a failed spot check goes back to the bay).
 */
export const WASH_TRANSITIONS: Record<WashStep, WashStep[]> = {
  QUEUED: ['WASHING'],
  WASHING: ['VACUUMING', 'DETAILING', 'QUALITY_CHECK'],
  VACUUMING: ['DETAILING', 'QUALITY_CHECK'],
  DETAILING: ['QUALITY_CHECK'],
  QUALITY_CHECK: ['READY', 'WASHING'],
  READY: [],
}

export const WASH_TERMINAL: WashStep[] = ['READY']

/** The WO status each wash step drives (the WO walks in parallel, §2.2). */
export const WORK_ORDER_STATUS_FOR_STEP: Record<WashStep, WorkOrderTarget> = {
  QUEUED: 'CHECKED_IN',
  WASHING: 'IN_PROGRESS',
  VACUUMING: 'IN_PROGRESS',
  DETAILING: 'IN_PROGRESS',
  QUALITY_CHECK: 'QUALITY_CHECK',
  READY: 'READY_FOR_COLLECTION',
}

type WorkOrderTarget =
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'QUALITY_CHECK'
  | 'READY_FOR_COLLECTION'

export function canWashTransition(from: WashStep, to: WashStep): boolean {
  return WASH_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertWashTransition(from: WashStep, to: WashStep): void {
  if (!canWashTransition(from, to)) {
    throw new ApiError(
      'INVALID_WASH_STEP_TRANSITION',
      `Cannot move a wash job from ${from} to ${to}.`,
      409,
      { from, to, allowed: WASH_TRANSITIONS[from] ?? [] },
    )
  }
}
