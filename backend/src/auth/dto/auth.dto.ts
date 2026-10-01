import { z } from 'zod'
import { ApiProperty } from '@nestjs/swagger'

export const registerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(9).max(20),
  email: z.string().trim().email().max(255).optional(),
  password: z.string().min(10).max(128),
  // Optional invite/claim code for staff accounts (Phase 3 scope: staff are
  // still seeded; this supports password-claiming a seeded account).
  staffInviteCode: z.string().trim().optional(),
})

export const loginSchema = z.object({
  phoneOrEmail: z.string().trim().min(3).max(255),
  password: z.string().min(1).max(128),
  mfaCode: z.string().trim().regex(/^\d{6}$/).optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
})

export const mfaVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits.'),
})

export const otpRequestSchema = z.object({
  phone: z.string().trim().min(9).max(20),
  estimateId: z.string().uuid().optional(),
})

export const otpVerifySchema = z.object({
  phone: z.string().trim().min(9).max(20),
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits.'),
})

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>
export type OtpRequestInput = z.infer<typeof otpRequestSchema>
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export class RegisterDto {
  @ApiProperty() firstName: string
  @ApiProperty() lastName: string
  @ApiProperty({ example: '+254 712 345 678' }) phone: string
  @ApiProperty({ required: false }) email?: string
  @ApiProperty() password: string
  @ApiProperty({ required: false }) staffInviteCode?: string
}

export class LoginDto {
  @ApiProperty({ example: '+254 712 345 678' }) phoneOrEmail: string
  @ApiProperty() password: string
  @ApiProperty({ required: false, example: '123456' }) mfaCode?: string
}

export class ChangePasswordDto {
  @ApiProperty() currentPassword: string
  @ApiProperty() newPassword: string
}

export class MfaVerifyDto {
  @ApiProperty({ example: '123456' }) code: string
}

export class OtpRequestDto {
  @ApiProperty({ example: '+254 712 345 678' }) phone: string
  @ApiProperty({ required: false, format: 'uuid' }) estimateId?: string
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+254 712 345 678' }) phone: string
  @ApiProperty({ example: '123456' }) code: string
}
