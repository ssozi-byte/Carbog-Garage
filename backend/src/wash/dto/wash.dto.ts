import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

/**
 * One press of the washer's five-button UI (§2.2): the target step plus
 * optional reason/notes. Idempotency comes from the X-Event-Id header —
 * client-generated UUIDs are the offline-safety contract (roadmap §86).
 */
export const washStepSchema = z.object({
  step: z.enum(['WASHING', 'VACUUMING', 'DETAILING', 'QUALITY_CHECK', 'READY']),
  reason: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
})

export type WashStepInput = z.infer<typeof washStepSchema>

export class WashStepDto {
  @ApiProperty({ example: 'WASHING', enum: ['WASHING', 'VACUUMING', 'DETAILING', 'QUALITY_CHECK', 'READY'] })
  step: string
  @ApiProperty({ required: false })
  reason?: string
  @ApiProperty({ required: false })
  notes?: string
}
