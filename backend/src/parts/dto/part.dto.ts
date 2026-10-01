import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const createPartSchema = z.object({
  sku: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(160),
  manufacturer: z.string().trim().max(120).optional(),
  partNumber: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  unitCostCents: z.number().int().min(0).max(100_000_000).default(0),
  sellingPriceCents: z.number().int().min(0).max(100_000_000).default(0),
  /** Initial stock-in — a PURCHASE ledger row is written for any amount > 0. */
  quantityOnHand: z.number().int().min(0).max(100_000).default(0),
  reorderLevel: z.number().int().min(0).max(100_000).default(0),
})
export type CreatePartInput = z.infer<typeof createPartSchema>

/** Metadata only — stock moves exclusively through adjustments/issues. */
export const updatePartSchema = createPartSchema
  .partial()
  .omit({ quantityOnHand: true, sku: true })
export type UpdatePartInput = z.infer<typeof updatePartSchema>

export const adjustStockSchema = z.object({
  type: z.enum(['PURCHASE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER']),
  /** Signed: negative for damage/shrinkage, positive for goods-in. */
  quantityDelta: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((v) => v !== 0, 'Quantity delta cannot be zero.'),
  unitCostCents: z.number().int().min(0).max(100_000_000).optional(),
  supplierRef: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(500).optional(),
})
export type AdjustStockInput = z.infer<typeof adjustStockSchema>

export const createPartRequestSchema = z.object({
  partId: z.string().uuid(),
  /** Whole units — parts are counted, not poured. */
  quantity: z.number().int().min(1).max(1000),
  note: z.string().trim().max(300).optional(),
})
export type CreatePartRequestInput = z.infer<typeof createPartRequestSchema>

export const orderPartRequestSchema = z.object({
  supplierRef: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
})
export type OrderPartRequestInput = z.infer<typeof orderPartRequestSchema>

export const cancelPartRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
})

export const listPartsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type ListPartsQuery = z.infer<typeof listPartsQuerySchema>

export const listRequestsQuerySchema = z.object({
  status: z.enum(['REQUESTED', 'ISSUED', 'ORDERED', 'CANCELLED']).optional(),
})
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>

// ---- Swagger classes ----

export class PartDto {
  @ApiProperty() sku: string
  @ApiProperty() name: string
  @ApiProperty({ required: false }) manufacturer?: string
  @ApiProperty({ required: false }) partNumber?: string
  @ApiProperty({ example: 210000 }) unitCostCents: number
  @ApiProperty({ example: 450000 }) sellingPriceCents: number
  @ApiProperty({ example: 8 }) quantityOnHand: number
  @ApiProperty({ example: 3 }) reorderLevel: number
}

export class AdjustStockDto {
  @ApiProperty({ enum: ['PURCHASE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER'] }) type: string
  @ApiProperty({ example: 10 }) quantityDelta: number
  @ApiProperty({ required: false, example: 210000 }) unitCostCents?: number
  @ApiProperty({ required: false }) supplierRef?: string
  @ApiProperty({ required: false }) notes?: string
}

export class CreatePartRequestDto {
  @ApiProperty({ format: 'uuid' }) partId: string
  @ApiProperty({ example: 1 }) quantity: number
  @ApiProperty({ required: false }) note?: string
}
