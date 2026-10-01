import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const resultStatusSchema = z.enum(['GOOD', 'WATCH', 'NEEDS_ATTENTION', 'CRITICAL', 'NOT_CHECKED'])
export const findingSeveritySchema = z.enum(['OK', 'WATCH', 'ATTENTION', 'CRITICAL'])

export const upsertResultSchema = z.object({
  itemId: z.string().uuid(),
  status: resultStatusSchema,
  measurement: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(12).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  photoMediaId: z.string().uuid().nullable().optional(),
})
export type UpsertResultInput = z.infer<typeof upsertResultSchema>

export const promoteFindingSchema = z.object({
  resultId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(140),
  severity: findingSeveritySchema.optional(),
  recommendation: z.string().trim().max(300).optional(),
})
export type PromoteFindingInput = z.infer<typeof promoteFindingSchema>

export const reviewFindingSchema = z.object({
  customerTitle: z.string().trim().min(3).max(140).optional(),
  customerExplanation: z.string().trim().max(1000).optional(),
  customerVisible: z.boolean().optional(),
})
export type ReviewFindingInput = z.infer<typeof reviewFindingSchema>

export const findingDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'DECLINE', 'DEFER']),
  reason: z.string().trim().max(40).optional(), // TOO_EXPENSIVE | LATER | NEED_INFO | OTHER
  note: z.string().trim().max(500).optional(),
  followUpAt: z.string().datetime().optional(),
})
export type FindingDecisionInput = z.infer<typeof findingDecisionSchema>

// ---- Swagger classes ----

export class UpsertResultDto {
  @ApiProperty({ format: 'uuid' }) itemId: string
  @ApiProperty({ enum: ['GOOD', 'WATCH', 'NEEDS_ATTENTION', 'CRITICAL', 'NOT_CHECKED'] }) status: string
  @ApiProperty({ required: false, nullable: true, type: 'number' }) measurement?: number | null
  @ApiProperty({ required: false, nullable: true }) unit?: string | null
  @ApiProperty({ required: false, nullable: true }) note?: string | null
  @ApiProperty({ required: false, nullable: true, format: 'uuid' }) photoMediaId?: string | null
}

export class PromoteFindingDto {
  @ApiProperty() title: string
  @ApiProperty({ required: false, format: 'uuid' }) resultId?: string
  @ApiProperty({ required: false, enum: ['OK', 'WATCH', 'ATTENTION', 'CRITICAL'] }) severity?: string
  @ApiProperty({ required: false }) recommendation?: string
}

export class FindingDecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'DECLINE', 'DEFER'] }) decision: string
  @ApiProperty({ required: false }) reason?: string
  @ApiProperty({ required: false }) note?: string
  @ApiProperty({ required: false, format: 'date-time' }) followUpAt?: string
}
