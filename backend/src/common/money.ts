/**
 * Integer money helpers (Phase 5E — shared by estimates and invoices).
 * Money is integer KES cents; quantities are thousandths (qtyMilli — a
 * 0.5 h labour line is 500). No floats anywhere near money.
 */

export const VAT_RATE_MILLI = 160_000 // 16% VAT, thousandths-based

/** round(qtyMilli × unitPriceCents / 1000) — no float money anywhere. */
export function lineTotal(qtyMilli: number, unitPriceCents: number): number {
  return Math.round((qtyMilli * unitPriceCents) / 1000)
}

/** 16% VAT on a cents subtotal: rate(milli) × cents / 1e6 — both carry ×1000. */
export function vatOn(subtotalCents: number): number {
  return Math.round((subtotalCents * VAT_RATE_MILLI) / 1_000_000)
}
