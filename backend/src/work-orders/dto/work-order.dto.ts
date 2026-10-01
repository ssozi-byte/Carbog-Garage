import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const woStatusChangeSchema = z.object({
  status: z.enum([
    'PENDING', 'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL', 'APPROVED',
    'IN_PROGRESS', 'WAITING_PARTS', 'TESTING', 'QUALITY_CHECK',
    'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW',
  ]),
  reason: z.string().trim().max(500).optional(),
})

export const woAssignSchema = z.object({
  technicianId: z.string().uuid(),
})

export type WoStatusChangeInput = z.infer<typeof woStatusChangeSchema>
export type WoAssignInput = z.infer<typeof woAssignSchema>

export class WoStatusChangeDto {
  @ApiProperty({ example: 'IN_PROGRESS' }) status: string
  @ApiProperty({ required: false }) reason?: string
}

export class WoAssignDto {
  @ApiProperty({ format: 'uuid' }) technicianId: string
}
