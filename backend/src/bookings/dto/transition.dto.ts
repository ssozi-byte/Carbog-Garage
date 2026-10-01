import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const confirmBookingSchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM (24h).'),
  internalNotes: z.string().trim().max(2000).optional(),
})

export const statusChangeSchema = z.object({
  status: z.enum([
    'CONFIRMED',
    'CHECKED_IN',
    'INSPECTION',
    'AWAITING_APPROVAL',
    'APPROVED',
    'IN_PROGRESS',
    'READY_FOR_COLLECTION',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ]),
  reason: z.string().trim().max(500).optional(),
})

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3, 'A short reason is required.').max(500),
})

export class ConfirmBookingDto {
  @ApiProperty({ example: '2026-10-01' }) scheduledDate: string
  @ApiProperty({ example: '10:00' }) scheduledTime: string
  @ApiProperty({ required: false }) internalNotes?: string
}

export class StatusChangeDto {
  @ApiProperty({ example: 'CHECKED_IN' }) status: string
  @ApiProperty({ required: false }) reason?: string
}

export class CancelBookingDto {
  @ApiProperty({ example: 'Customer requested cancellation by phone' }) reason: string
}
