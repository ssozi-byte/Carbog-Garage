export interface PageMeta {
  page: number
  limit: number
  total: number
}

export const DEFAULT_PAGE = 1
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100 // Spec §41 — never allow limit=1000000

/** Clamps and validates pagination input; safe for direct query use. */
export function clampPagination(
  page: number | undefined,
  limit: number | undefined,
): { skip: number; take: number; page: number; limit: number } {
  const p = Number.isFinite(page) && page! >= 1 ? Math.floor(page!) : DEFAULT_PAGE
  const l = Number.isFinite(limit) && limit! >= 1 ? Math.min(Math.floor(limit!), MAX_LIMIT) : DEFAULT_LIMIT
  return { skip: (p - 1) * l, take: l, page: p, limit: l }
}
