import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const estimateItemKindSchema = z.enum(['PART', 'LABOUR'])

export const estimateItemInputSchema = z.object({
  findingId: z.string().uuid().optional(),
  /** Catalog part this line prices (enables 5E invoice dedupe per part). */
  partId: z.string().uuid().optional(),
  kind: estimateItemKindSchema,
  description: z.string().trim().min(3).max(300),
  qtyMilli: z.number().int().min(1).max(1_000_000).default(1000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
})

export const createEstimateSchema = z.object({
  items: z.array(estimateItemInputSchema).min(1).max(100),
  /** Number of days until the offer lapses (default 14). */
  validDays: z.number().int().min(1).max(90).optional(),
})
export type CreateEstimateInput = z.infer<typeof createEstimateSchema>
export type EstimateItemInput = z.infer<typeof estimateItemInputSchema>

export const declineEstimateSchema = z.object({
  reason: z.enum(['TOO_EXPENSIVE', 'LATER', 'NEED_INFO', 'OTHER']),
  note: z.string().trim().max(500).optional(),
  /** ISO datetime — sets the follow-up reminder on every covered finding. */
  followUpAt: z.string().datetime().optional(),
})
export type DeclineEstimateInput = z.infer<typeof declineEstimateSchema>

// ---- Swagger classes ----

export class EstimateItemDto {
  @ApiProperty({ enum: ['PART', 'LABOUR'] }) kind: string
  @ApiProperty() description: string
  @ApiProperty({ required: false, format: 'uuid' }) findingId?: string
  @ApiProperty({ required: false, example: 1000 }) qtyMilli?: number
  @ApiProperty({ example: 450000 }) unitPriceCents: number
}

export class CreateEstimateDto {
  @ApiProperty({ type: [EstimateItemDto] }) items: EstimateItemDto[]
  @ApiProperty({ required: false }) validDays?: number
}

export class DeclineEstimateDto {
  @ApiProperty({ enum: ['TOO_EXPENSIVE', 'LATER', 'NEED_INFO', 'OTHER'] }) reason: string
  @ApiProperty({ required: false }) note?: string
  @ApiProperty({ required: false, format: 'date-time' }) followUpAt?: string
}

export class OtpApproveDto {
  @ApiProperty({ required: false, example: '+254 712 345 678' }) phone?: string
  @ApiProperty({ required: false, example: '123456' }) code?: string
  @ApiProperty({ required: false }) note?: string
}

export class OtpDeclineDto extends OtpApproveDto {
  @ApiProperty({ enum: ['TOO_EXPENSIVE', 'LATER', 'NEED_INFO', 'OTHER'] }) reason: string
  @ApiProperty({ required: false, format: 'date-time' }) followUpAt?: string
}

/**
 * Decision credentials: a Bearer OTP scope token on the request, OR a
 * one-shot {phone, code} body (the code is consumed by the decision).
 */
export const otpDecisionSchema = z.object({
  phone: z.string().trim().min(9).max(20).optional(),
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits.').optional(),
  note: z.string().trim().max(500).optional(),
  reason: z.enum(['TOO_EXPENSIVE', 'LATER', 'NEED_INFO', 'OTHER']).optional(),
  followUpAt: z.string().datetime().optional(),
})
export type OtpDecisionInput = z.infer<typeof otpDecisionSchema>
