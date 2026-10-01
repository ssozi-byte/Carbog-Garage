import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const composeInvoiceSchema = z.object({
  /** Extra lines beyond the approved estimate + issued parts (e.g. misc). */
  extraItems: z
    .array(
      z.object({
        itemType: z.enum(['SERVICE', 'PART', 'OTHER']).default('OTHER'),
        description: z.string().trim().min(3).max(300),
        qtyMilli: z.number().int().min(1).max(1_000_000).default(1000),
        unitPriceCents: z.number().int().min(0).max(100_000_000),
      }),
    )
    .max(100)
    .default([]),
  /** Whole-KES discount, cents. Cannot exceed the subtotal. */
  discountCents: z.number().int().min(0).max(100_000_000).default(0),
  /** Invoice terms (default: due on issue = now). */
  dueDays: z.number().int().min(0).max(90).optional(),
})
export type ComposeInvoiceInput = z.infer<typeof composeInvoiceSchema>

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
})
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>

export const createPaymentSchema = z.object({
  method: z.enum(['MPESA', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']),
  amountCents: z.number().int().min(1).max(100_000_000),
  /** MPESA only: the MSISDN to push the STK prompt to. */
  phoneNumber: z.string().trim().min(9).max(20).optional(),
  /** Client outbox key; server generates one when absent. */
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
})
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>

// ---- Swagger classes ----

export class ComposeInvoiceDto {
  @ApiProperty({ type: 'object', additionalProperties: true, required: false }) extraItems?: unknown[]
  @ApiProperty({ required: false, example: 0 }) discountCents?: number
  @ApiProperty({ required: false }) dueDays?: number
}

export class CreatePaymentDto {
  @ApiProperty({ enum: ['MPESA', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'] }) method: string
  @ApiProperty({ example: 638000 }) amountCents: number
  @ApiProperty({ required: false, example: '+254712345678' }) phoneNumber?: string
  @ApiProperty({ required: false }) idempotencyKey?: string
}
