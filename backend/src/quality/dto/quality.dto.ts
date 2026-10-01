import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

/**
 * The fixed QC checklist (roadmap §4): every box must be ticked for the
 * job to clear the READY_FOR_COLLECTION gate on REPAIR/SERVICE types.
 */
export const submitQcSchema = z.object({
  repairCompleted: z.boolean().default(false),
  partsInstalled: z.boolean().default(false),
  noLeaks: z.boolean().default(false),
  warningLights: z.boolean().default(false),
  testDrive: z.boolean().default(false),
  toolsRemoved: z.boolean().default(false),
  vehicleCleaned: z.boolean().default(false),
  belongingsChecked: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
})
export type SubmitQcInput = z.infer<typeof submitQcSchema>

export const qcDecisionSchema = z.object({
  approved: z.literal(true).optional(),
  rejectedReason: z.string().trim().min(3).max(300).optional(),
})
export type QcDecisionInput = z.infer<typeof qcDecisionSchema>

export class QcSubmitDto {
  @ApiProperty({ example: true }) repairCompleted: boolean
  @ApiProperty({ example: true }) partsInstalled: boolean
  @ApiProperty({ example: true }) noLeaks: boolean
  @ApiProperty({ example: true }) warningLights: boolean
  @ApiProperty({ example: true }) testDrive: boolean
  @ApiProperty({ example: true }) toolsRemoved: boolean
  @ApiProperty({ example: true }) vehicleCleaned: boolean
  @ApiProperty({ example: true }) belongingsChecked: boolean
  @ApiProperty({ required: false }) notes?: string
}
