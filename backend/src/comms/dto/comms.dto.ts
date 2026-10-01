import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

/** Manager broadcast audiences (roadmap §151/§16). */
const AUDIENCES = [
  'ALL_CUSTOMERS',
  'SPECIFIC_CUSTOMER',
  'SPECIFIC_VEHICLE',
  'SPECIFIC_JOB',
  'ALL_STAFF',
  'MECHANICS',
  'WASHERS',
] as const

/** zod contract + Swagger class in one file, matching the wash module pattern. */
export const broadcastSchema = z
  .object({
    audience: z.enum(AUDIENCES),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(2000),
    attachmentMediaId: z.string().uuid().optional(),
    targetCustomerId: z.string().uuid().optional(),
    targetVehicleId: z.string().uuid().optional(),
    targetWorkOrderId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === 'SPECIFIC_CUSTOMER' && !v.targetCustomerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetCustomerId'], message: 'targetCustomerId is required for SPECIFIC_CUSTOMER.' })
    }
    if (v.audience === 'SPECIFIC_VEHICLE' && !v.targetVehicleId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetVehicleId'], message: 'targetVehicleId is required for SPECIFIC_VEHICLE.' })
    }
    if (v.audience === 'SPECIFIC_JOB' && !v.targetWorkOrderId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetWorkOrderId'], message: 'targetWorkOrderId is required for SPECIFIC_JOB.' })
    }
  })

export type BroadcastInput = z.infer<typeof broadcastSchema>

export class BroadcastDto {
  @ApiProperty({ enum: AUDIENCES, example: 'ALL_CUSTOMERS' })
  audience: string
  @ApiProperty({ example: 'Holiday hours' })
  title: string
  @ApiProperty({ example: 'We are open 8am–5pm through the holidays.' })
  body: string
  @ApiProperty({ required: false })
  attachmentMediaId?: string
  @ApiProperty({ required: false })
  targetCustomerId?: string
  @ApiProperty({ required: false })
  targetVehicleId?: string
  @ApiProperty({ required: false })
  targetWorkOrderId?: string
}

export const createReminderSchema = z
  .object({
    vehicleId: z.string().uuid(),
    kind: z.enum(['MILEAGE', 'TIME']),
    dueMileage: z.number().int().min(0).max(3_000_000).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD').optional(),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'MILEAGE' && v.dueMileage === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueMileage'], message: 'dueMileage is required for MILEAGE reminders.' })
    }
    if (v.kind === 'TIME' && v.dueDate === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'dueDate is required for TIME reminders.' })
    }
  })

export type CreateReminderInput = z.infer<typeof createReminderSchema>

export class CreateReminderDto {
  @ApiProperty({ format: 'uuid' })
  vehicleId: string
  @ApiProperty({ enum: ['MILEAGE', 'TIME'] })
  kind: string
  @ApiProperty({ required: false })
  dueMileage?: number
  @ApiProperty({ required: false, example: '2026-11-01' })
  dueDate?: string
  @ApiProperty({ example: 'Oil service — 5,000 km' })
  title: string
  @ApiProperty({ required: false })
  notes?: string
}

export const updateReminderSchema = z.object({
  dueMileage: z.number().int().min(0).max(3_000_000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['PENDING', 'DUE', 'SENT', 'DISMISSED']).optional(),
})

export type UpdateReminderInput = z.infer<typeof updateReminderSchema>

export class UpdateReminderDto {
  @ApiProperty({ required: false })
  dueMileage?: number
  @ApiProperty({ required: false })
  dueDate?: string | null
  @ApiProperty({ required: false })
  title?: string
  @ApiProperty({ required: false })
  notes?: string | null
  @ApiProperty({ required: false, enum: ['PENDING', 'DUE', 'SENT', 'DISMISSED'] })
  status?: string
}
