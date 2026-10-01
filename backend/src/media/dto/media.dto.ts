import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const uploadUrlSchema = z.object({
  entityType: z.enum(['WORK_ORDER', 'INSPECTION_RUN', 'INSPECTION_RESULT', 'VEHICLE_CHECKIN']),
  entityId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  tag: z.string().trim().max(40).optional(),
})
export type UploadUrlInput = z.infer<typeof uploadUrlSchema>

export class UploadUrlDto {
  @ApiProperty({ enum: ['WORK_ORDER', 'INSPECTION_RUN', 'INSPECTION_RESULT', 'VEHICLE_CHECKIN'] }) entityType: string
  @ApiProperty({ format: 'uuid' }) entityId: string
  @ApiProperty() filename: string
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] }) mimeType: string
  @ApiProperty({ type: 'integer' }) sizeBytes: number
  @ApiProperty({ required: false }) tag?: string
}
