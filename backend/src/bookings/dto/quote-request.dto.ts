import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

/**
 * Guest booking request — mirrors the existing ContactPage form fields
 * exactly (Spec §69: preserve the current UX).
 */
export const quoteRequestSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short.').max(120),
  phone: z
    .string()
    .trim()
    .min(9, 'Phone number looks too short.')
    .max(20, 'Phone number looks too long.'),
  vehicleText: z.string().trim().min(2).max(120).optional(),
  serviceName: z.string().trim().min(1).max(140).optional(),
  message: z.string().trim().max(2000).optional(),
})

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>

export class QuoteRequestDto {
  @ApiProperty({ example: 'Brian Mwangi' }) name: string
  @ApiProperty({ example: '+254 712 345 678' }) phone: string
  @ApiProperty({ required: false, example: 'Toyota Fielder 2016' }) vehicleText?: string
  @ApiProperty({ required: false, example: 'Vehicle Diagnostics' }) serviceName?: string
  @ApiProperty({ required: false }) message?: string
}

export class QuoteRequestResponseDto {
  @ApiProperty({ example: 'MOT-2026-000123' }) bookingNumber: string
  @ApiProperty({ enum: ['REQUESTED'] }) status: string
}
