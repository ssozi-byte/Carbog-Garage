import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { AuthService, publicUser } from './auth.service'
import { OtpService } from './otp.service'
import { AuthedUser, JwtAuthGuard } from './jwt-auth.guard'
import { Roles, RolesGuard } from './roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { ApiError } from '../common/errors/error-codes'
import {
  AuthLoginRateLimitMiddleware,
  AuthOtpRateLimitMiddleware,
  AuthRefreshRateLimitMiddleware,
  AuthRegisterRateLimitMiddleware,
} from '../common/middleware/rate-limit.factory'
import {
  changePasswordSchema,
  loginSchema,
  mfaVerifySchema,
  registerSchema,
  otpRequestSchema,
  otpVerifySchema,
  type ChangePasswordInput,
  type LoginInput,
  type MfaVerifyInput,
  type OtpRequestInput,
  type OtpVerifyInput,
  type RegisterInput,
  OtpRequestDto,
  OtpVerifyDto,
} from './dto/auth.dto'

const REFRESH_COOKIE = 'motora_refresh'
const REFRESH_COOKIE_PATH = '/api/v1/auth'

function loginMeta(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  }
}

function authed(req: Request): AuthedUser {
  const u = (req as Request & { user?: AuthedUser }).user
  if (!u) throw ApiError.unauthorized()
  return u
}

/**
 * Auth endpoints (api-contract §1). Refresh tokens live ONLY in an httpOnly
 * cookie scoped to /api/v1/auth; bodies never carry them (§36).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
  ) {}

  // ---- Public ------------------------------------------------------------

  @Post('register')
  @ApiOperation({ summary: 'Create a customer account (or claim a staff account with an invite code)' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, expiresIn } = await this.auth.register(body, loginMeta(req))
    const pair = await this.auth.issueSession(user, loginMeta(req))
    this.setRefreshCookie(res, pair.refreshToken, pair.refreshExpiresAt)
    return { user: publicUser(user), expiresIn: pair.expiresIn }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with phone or email; returns mfaRequired when a TOTP factor is active' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = loginMeta(req)
    const result = await this.auth.login(body, meta)
    if (result.mfaRequired || !result.pair) {
      // 200 + flag (contract §1) — client re-posts with mfaCode.
      return { mfaRequired: true }
    }
    this.setRefreshCookie(res, result.pair.refreshToken, result.pair.refreshExpiresAt)
    return {
      user: publicUser(result.user!),
      accessToken: result.pair.accessToken,
      expiresIn: result.pair.expiresIn,
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh session and get a fresh access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = this.readRefreshCookie(req)
    const result = await this.auth.refresh(presented, loginMeta(req))
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
    return { accessToken: result.accessToken }
  }

  // ---- OTP phone sign-in (guest approvals, roadmap v2 §10.1) --------------

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a one-time code to a phone (guest approval sign-in)' })
  @ApiBody({ type: OtpRequestDto })
  otpRequest(@Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequestInput, @Req() req: Request) {
    return this.otp.requestCode(body.phone, 'ESTIMATE_APPROVAL', loginMeta(req), body.estimateId)
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the code and receive a short-lived estimate-scoped token' })
  @ApiBody({ type: OtpVerifyDto })
  otpVerify(@Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyInput, @Req() req: Request) {
    return this.otp.verifyCode(body.phone, 'ESTIMATE_APPROVAL', body.code, loginMeta(req))
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke the current refresh session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE])
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
    return { message: 'Logged out.' }
  }

  // ---- Authenticated -----------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List your active login sessions' })
  listSessions(@Req() req: Request) {
    return this.auth.listSessions(authed(req).id)
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke one of your sessions (e.g. a lost device)' })
  async revokeSession(@Param('id') id: string, @Req() req: Request) {
    await this.auth.revokeSession(authed(req).id, id)
    return { message: 'Session revoked.' }
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change password; revokes all other sessions' })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(authed(req).id, body, loginMeta(req))
    return { message: 'Password updated. Other sessions were signed out.' }
  }

  // ---- MFA (ADMIN+ per contract §1) ---------------------------------------

  @Post('mfa/enroll')
  @HttpCode(HttpStatus.OK) // per contract §1 — enrollment returns 200, not 201
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN+')
  @ApiOperation({ summary: 'Start TOTP enrollment — returns otpauthUrl + one-time secret' })
  mfaEnroll(@Req() req: Request) {
    const u = authed(req)
    return this.auth.mfaEnroll(u.id, u.email ?? u.phone)
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN+')
  @ApiOperation({ summary: 'Confirm TOTP enrollment with a 6-digit code' })
  async mfaVerify(@Body(new ZodValidationPipe(mfaVerifySchema)) body: MfaVerifyInput, @Req() req: Request) {
    await this.auth.mfaVerify(authed(req).id, body.code)
    return { message: 'MFA enabled.' }
  }

  // ---- helpers -------------------------------------------------------------

  private readRefreshCookie(req: Request): string {
    const token = req.cookies?.[REFRESH_COOKIE]
    if (!token || typeof token !== 'string') {
      throw new ApiError('INVALID_TOKEN', 'No refresh session found. Please log in.', 401)
    }
    return token
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      path: REFRESH_COOKIE_PATH,
      expires: expiresAt,
    })
  }
}
