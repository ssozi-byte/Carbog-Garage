import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomInt } from 'node:crypto'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { normalizeKenyanPhone } from '../common/utils/phone'
import { safeEqual } from './crypto.util'
import type { AccessMeta } from './auth.service'
import type { OtpPurpose } from '@prisma/client'

/**
 * OTP phone sign-in (roadmap v2 §10.1): estimates are sent to guests who may
 * never have registered — phone-number-first identity, no forced passwords.
 * No SMS provider is wired yet, so the delivery boundary is `deliverCode()`;
 * in dev the code is echoed in the response ONLY (NODE_ENV !== 'production')
 * so the e2e suite and curl walkthroughs stay possible.
 */
const OTP_TTL_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5
const OTP_WINDOW_MS = 15 * 60_000 // resend window per phone
const OTP_MAX_PER_WINDOW = 3
const TOKEN_TTL_SECONDS = 15 * 60

export interface OtpScope {
  /** Deliberately narrow — this token proves one action on one estimate. */
  estimateId: string
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Issues a code for the phone, invalidating any previous pending one. */
  async requestCode(
    rawPhone: string,
    purpose: OtpPurpose,
    meta: AccessMeta,
    estimateId?: string,
  ): Promise<{ phone: string; expiresAt: Date; devCode?: string }> {
    const phone = normalizeKenyanPhone(rawPhone)
    if (!phone) throw ApiError.validation('Please enter a valid Kenyan phone number, e.g. 0712 345 678.')

    const since = new Date(Date.now() - OTP_WINDOW_MS)
    const recent = await this.prisma.otpCode.count({
      where: { phone, purpose, createdAt: { gte: since } },
    })
    if (recent >= OTP_MAX_PER_WINDOW) {
      throw new ApiError('OTP_RATE_LIMITED', 'Too many codes requested. Please wait 15 minutes.', 429)
    }

    // One live code per phone+purpose — issuing a new one supersedes the old.
    await this.prisma.otpCode.updateMany({
      where: { phone, purpose, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    })

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000)
    await this.prisma.otpCode.create({
      data: {
        phone,
        purpose,
        estimateId,
        codeHash: this.hashCode(phone, code),
        expiresAt,
      },
    })

    await this.deliverCode(phone, code, meta)

    // devCode NEVER leaves the server in production — the message would be a
    // complete authentication bypass for anyone holding the request URL.
    const dev = this.config.get<string>('NODE_ENV')
    return { phone, expiresAt, ...(dev !== 'production' ? { devCode: code } : {}) }
  }

  /**
   * Verifies a code and mints a short-lived, purpose-scoped JWT the client
   * presents as the regular Bearer token on the approval route.
   */
  async verifyCode(
    rawPhone: string,
    purpose: OtpPurpose,
    code: string,
    meta: AccessMeta,
  ): Promise<{ phone: string; scopeToken: string; scope: OtpScope; expiresIn: number }> {
    const phone = normalizeKenyanPhone(rawPhone)
    if (!phone) throw new ApiError('OTP_INVALID', 'Invalid or expired code.', 401)

    const row = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    const fail = async () => {
      // Burn an attempt only when a live challenge exists (enumeration safety).
      if (row) {
        const attempts = row.attempts + 1
        await this.prisma.otpCode.update({
          where: { id: row.id },
          data: { attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { status: 'MAXED_OUT' } : {}) },
        })
      }
      throw new ApiError('OTP_INVALID', 'Invalid or expired code.', 401)
    }

    if (!row || row.expiresAt < new Date()) {
      await this.prisma.otpCode.updateMany({
        where: { id: row?.id ?? '', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }).catch(() => undefined)
      await fail()
    }

    if (!safeEqual(row!.codeHash, this.hashCode(phone, code))) await fail()

    if (!row!.estimateId) {
      throw ApiError.validation('This code is not tied to a pending approval.')
    }
    await this.prisma.otpCode.update({
      where: { id: row!.id },
      data: { status: 'VERIFIED', consumedAt: new Date() },
    })

    const scope: OtpScope = { estimateId: row!.estimateId }
    const scopeToken = await this.jwt.signAsync({ sub: `otp:${phone}`, scope, purpose }, {
      expiresIn: TOKEN_TTL_SECONDS,
    })
    return { phone, scopeToken, scope, expiresIn: TOKEN_TTL_SECONDS }
  }

  /** Verifies a scope token's signature, type, purpose and expiry. */
  async verifyScopeToken(token: string): Promise<{ phone: string; scope: OtpScope }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string; scope?: OtpScope; purpose?: string; exp?: number }>(token)
      if (!payload.scope?.estimateId || payload.purpose !== 'ESTIMATE_APPROVAL' || !payload.sub?.startsWith('otp:')) {
        throw new Error('wrong token type')
      }
      return { phone: payload.sub.slice(4), scope: payload.scope }
    } catch {
      throw new ApiError('INVALID_TOKEN', 'Approval link is invalid or has expired. Request a new code.', 401)
    }
  }

  /** Deliverability seam — Phase 8 rides the notification pipeline here. */
  private async deliverCode(phone: string, code: string, meta: AccessMeta): Promise<void> {
    // TODO(Phase 8): route through notification_logs (SMS channel).
    console.info(JSON.stringify({ otp: { phone, code, ip: meta.ip } }))
  }

  private hashCode(phone: string, code: string): string {
    return createHash('sha256').update(`${phone}:${code}`).digest('hex')
  }
}
