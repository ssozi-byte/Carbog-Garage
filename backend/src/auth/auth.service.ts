import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Prisma, User } from '@prisma/client'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { normalizeKenyanPhone } from '../common/utils/phone'
import {
  decryptSecret,
  encryptSecret,
  generateRefreshToken,
  generateTotpSecret,
  hashPassword,
  hashRefreshToken,
  isStrongPassword,
  totpUri,
  verifyPassword,
  verifyTotp,
} from './crypto.util'
import type { RegisterInput, LoginInput, ChangePasswordInput } from './dto/auth.dto'

/** Public shape of a user — never leaks password hashes or factor secrets (§36). */
export function publicUser(u: User) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    email: u.email,
    role: u.role,
    status: u.status,
    mfaEnforced: u.mfaEnforced,
    garageId: u.garageId,
  }
}

export interface AccessMeta {
  ip?: string
  userAgent?: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** Seconds until the access token expires (sent to clients as `expiresIn`). */
  expiresIn: number
  refreshExpiresAt: Date
}

const LOGIN_WINDOW_MS = 15 * 60_000 // 15 min sliding window
const LOGIN_MAX_FAILURES = 5 // per IP+identifier (§13.5), then ACCOUNT_LOCKED
const LOCKOUT_MINUTES = 15

/** Role rank for RBAC hierarchy (higher wins). Spec treats roles as capability sets. */
export const ROLE_RANK: Record<string, number> = {
  CUSTOMER: 1,
  MECHANIC: 2,
  WASHER: 2, // wash-bay technician — rank-equal to MECHANIC (Phase 6)
  SERVICE_ADVISOR: 3,
  INVENTORY_MANAGER: 3,
  CASHIER: 3,
  ADMIN: 4,
  SUPER_ADMIN: 5,
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------
  // Register / staff-claim
  // ------------------------------------------------------------------

  /**
   * Creates a CUSTOMER account (Argon2id). If the phone already belongs to a
   * passwordless guest (created by a Phase 4 quote-request), the account is
   * UPGRADED in place. With `staffInviteCode`, a seeded staff account can
   * claim credentials instead — role stays as seeded (never client-set).
   */
  async register(input: RegisterInput, meta: AccessMeta): Promise<{ user: User; expiresIn: number }> {
    const phone = normalizeKenyanPhone(input.phone)
    if (!phone) {
      throw ApiError.validation('Please enter a valid Kenyan phone number, e.g. 0712 345 678.')
    }
    if (!isStrongPassword(input.password)) {
      throw new ApiError('WEAK_PASSWORD', 'Password must be at least 10 characters and include a letter and a number.', 400)
    }

    const email = input.email?.trim().toLowerCase() || null

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phone }, ...(email ? [{ email }] : [])], deletedAt: null },
    })

    if (existing) {
      const claimsStaff =
        input.staffInviteCode !== undefined &&
        input.staffInviteCode !== '' &&
        existing.role !== 'CUSTOMER' &&
        existing.passwordHash === null

      if (claimsStaff) {
        const expected = this.config.get<string>('STAFF_INVITE_CODE')
        if (!expected || input.staffInviteCode !== expected) {
          throw new ApiError('FORBIDDEN', 'Invalid staff invite code.', 403)
        }
        // Claim the seeded staff account: set credentials, activate.
        const claimed = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await hashPassword(input.password),
            status: 'ACTIVE',
            phone, // e.g. 0712… guest may re-register under a different format
            email: existing.email ?? email,
          },
        })
        await this.securityEvent('FAILED_LOGIN', claimed.id, claimed.garageId, 'staff_claim', meta, {
          note: 'staff account claimed via invite code',
        })
        return { user: claimed, expiresIn: this.accessTtlSeconds() }
      }

      if (existing.phone === phone && existing.passwordHash === null && existing.role === 'CUSTOMER') {
        // Passwordless guest upgrade (Phase 4 quote-request account).
        const upgraded = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await hashPassword(input.password),
            status: 'ACTIVE',
            firstName: input.firstName,
            lastName: input.lastName,
            ...(email ? { email } : {}),
          },
        })
        return { user: upgraded, expiresIn: this.accessTtlSeconds() }
      }

      if (existing.phone === phone) throw ApiError.conflict('PHONE_TAKEN', 'An account with this phone number already exists.')
      throw ApiError.conflict('EMAIL_TAKEN', 'An account with this email already exists.')
    }

    if (email) {
      const emailTaken = await this.prisma.user.findFirst({ where: { email }, select: { id: true } })
      if (emailTaken) throw ApiError.conflict('EMAIL_TAKEN', 'An account with this email already exists.')
    }

    // New customers land in the garage's tenant scope.
    const garage = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!garage) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')

    const user = await this.prisma.user.create({
      data: {
        garageId: garage.id,
        phone,
        email,
        passwordHash: await hashPassword(input.password),
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    })

    return { user, expiresIn: this.accessTtlSeconds() }
  }

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  /**
   * Phone-or-email login. Order of defenses:
   *   1. IP+identifier throttle (login_attempts, 5 failures/15 min)
   *   2. Per-account lockout (failedLoginCount → lockedUntil)
   *   3. Argon2id verify → TOTP when enforced → session issuance
   * Every attempt is logged; failures raise security events (§37).
   */
  async login(
    input: LoginInput,
    meta: AccessMeta,
  ): Promise<{ user?: User; accessToken?: string; mfaRequired?: boolean; pair?: TokenPair }> {
    const identifier = input.phoneOrEmail.trim().toLowerCase()
    const phone = normalizeKenyanPhone(input.phoneOrEmail)
    const ip = meta.ip

    // Look up by normalized phone and/or email. Identifiers that are neither
    // (e.g. garbage input) skip the query entirely — no user, straight fail.
    const orConditions: Prisma.UserWhereInput[] = []
    if (phone) orConditions.push({ phone })
    if (identifier.includes('@')) orConditions.push({ email: identifier })

    const user = orConditions.length
      ? await this.prisma.user.findFirst({ where: { deletedAt: null, OR: orConditions } })
      : null

    // Lockout is checked BEFORE the throttle so a locked account answers
    // ACCOUNT_LOCKED immediately (the throttle would 429 the same request).
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordAttempt(identifier, user.id, false, meta)
      await this.securityEvent('ACCOUNT_LOCKOUT', user.id, user.garageId, 'login', meta)
      throw new ApiError('ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed logins. Try again later.', 423)
    }

    await this.assertNotThrottled(identifier, ip, meta)

    const fail = async (userId?: string, event: 'FAILED_LOGIN' | 'ACCOUNT_LOCKOUT' = 'FAILED_LOGIN') => {
      await this.recordAttempt(identifier, userId, false, meta)
      await this.securityEvent(event, userId, user?.garageId, 'login', meta)
      // Generic message — never reveal whether the account exists (§28).
      throw new ApiError('INVALID_CREDENTIALS', 'Invalid phone/email or password.', 401)
    }

    if (!user || !user.passwordHash) return fail()

    const passwordOk = await verifyPassword(user.passwordHash, input.password)
    if (!passwordOk) {
      const failed = user.failedLoginCount + 1
      const lock = failed >= LOGIN_MAX_FAILURES
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failed,
          ...(lock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : {}),
        },
      })
      return fail(user.id, lock ? 'ACCOUNT_LOCKOUT' : 'FAILED_LOGIN')
    }

    // MFA gate — admins (+ anyone with a confirmed factor) must present a code.
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId: user.id, type: 'TOTP', confirmedAt: { not: null }, disabledAt: null },
      select: { id: true, secretEncrypted: true },
    })
    // MFA challenge fires when a CONFIRMED TOTP factor exists. Accounts that
    // are enforced-but-not-yet-enrolled (e.g. the seeded owner) can still log
    // in and self-enroll — avoids a permanent chicken-and-egg lockout.
    const mfaNeeded = factor !== null
    if (mfaNeeded && !input.mfaCode) {
      // 200 + flag per api-contract §1 — the client then re-posts with mfaCode.
      return { mfaRequired: true }
    }
    if (mfaNeeded && input.mfaCode) {
      const secret = await decryptSecret(factor!.secretEncrypted)
      if (!verifyTotp(secret, input.mfaCode)) {
        await this.recordAttempt(identifier, user.id, false, meta)
        await this.securityEvent('FAILED_LOGIN', user.id, user.garageId, 'login_mfa', meta)
        throw new ApiError('MFA_INVALID', 'Invalid authenticator code.', 401)
      }
      await this.prisma.mfaFactor.update({ where: { id: factor.id }, data: { lastUsedAt: new Date() } })
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    })
    await this.recordAttempt(identifier, user.id, true, meta)

    const pair = await this.issueSession(user, meta)
    return { user, accessToken: pair.accessToken, pair }
  }

  /** Sliding failure window per IP+identifier (§13.5: login 5/15min). */
  private async assertNotThrottled(identifier: string, ip: string | undefined, meta: AccessMeta): Promise<void> {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS)
    const [byId, byIp] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: { identifier, success: false, createdAt: { gte: since } },
      }),
      ip
        ? this.prisma.loginAttempt.count({
            where: { ip, success: false, createdAt: { gte: since } },
          })
        : Promise.resolve(0),
    ])
    if (byId >= LOGIN_MAX_FAILURES || byIp >= LOGIN_MAX_FAILURES * 4) {
      await this.securityEvent('RATE_LIMIT_EXCEEDED', undefined, undefined, 'login_throttle', meta, {
        identifier,
        failuresByIdentifier: byId,
        failuresByIp: byIp,
      })
      throw new ApiError(
        'RATE_LIMITED',
        'Too many failed login attempts. Please wait 15 minutes and try again.',
        429,
      )
    }
  }

  private async recordAttempt(
    identifier: string,
    userId: string | undefined,
    success: boolean,
    meta: AccessMeta,
  ): Promise<void> {
    await this.prisma.loginAttempt
      .create({
        data: {
          identifier: identifier.slice(0, 255),
          userId,
          success,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
        },
      })
      .catch(() => undefined)
  }

  private async securityEvent(
    eventType: 'FAILED_LOGIN' | 'ACCOUNT_LOCKOUT' | 'INVALID_TOKEN' | 'RATE_LIMIT_EXCEEDED',
    userId: string | undefined,
    garageId: string | undefined,
    resource: string,
    meta: AccessMeta,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.securityEvent
      .create({
        data: {
          garageId,
          userId,
          eventType,
          resource: resource.slice(0, 120),
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 255),
          metadata,
        },
      })
      .catch(() => undefined)
  }

  // ------------------------------------------------------------------
  // Sessions (opaque rotating refresh tokens)
  // ------------------------------------------------------------------

  /** Issues an access JWT + a persisted refresh session (only sha256 stored). */
  async issueSession(user: User, meta: AccessMeta): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user)
    const refreshToken = generateRefreshToken()
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs())

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        deviceLabel: this.deviceLabel(meta.userAgent),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: refreshExpiresAt,
      },
    })

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds(), refreshExpiresAt }
  }

  /**
   * Rotation with reuse detection (Spec §37): the presented token must match
   * an ACTIVE session. Valid → old revoked ('rotated') + new issued in one
   * transaction. Reused/revoked → all of the user's sessions are revoked
   * (possible theft) + INVALID_TOKEN security event.
   */
  async refresh(
    presented: string,
    meta: AccessMeta,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresAt: Date }> {
    const hash = hashRefreshToken(presented)
    const session = await this.prisma.refreshSession.findUnique({ where: { refreshTokenHash: hash } })

    if (!session || session.expiresAt < new Date()) {
      throw new ApiError('INVALID_TOKEN', 'Refresh session is invalid or expired.', 401)
    }
    if (session.revokedAt) {
      // Token reuse — a rotated token came back. Nuke every session (§37).
      await this.prisma.$transaction([
        this.prisma.refreshSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'reuse_detected' },
        }),
      ])
      const owner = await this.prisma.user.findUnique({ where: { id: session.userId }, select: { garageId: true } })
      await this.securityEvent('INVALID_TOKEN', session.userId, owner?.garageId, 'refresh', meta, {
        reason: 'refresh_token_reuse',
      })
      throw new ApiError('TOKEN_REVOKED', 'Session revoked for security. Please log in again.', 401)
    }

    const user = await this.prisma.user.findFirst({
      where: { id: session.userId, deletedAt: null, status: { notIn: ['SUSPENDED', 'LOCKED'] } },
    })
    if (!user) {
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'user_inactive' },
      })
      throw new ApiError('INVALID_TOKEN', 'Account is not active.', 401)
    }

    const accessToken = await this.signAccessToken(user)
    const nextToken = generateRefreshToken()
    const newRefreshExpiresAt = new Date(Date.now() + this.refreshTtlMs())

    await this.prisma.$transaction([
      this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'rotated' },
      }),
      this.prisma.refreshSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: hashRefreshToken(nextToken),
          deviceLabel: session.deviceLabel,
          ip: meta.ip ?? session.ip,
          userAgent: (meta.userAgent ?? session.userAgent)?.slice(0, 255),
          expiresAt: newRefreshExpiresAt,
          rotatedFromId: session.id,
        },
      }),
    ])

    return { accessToken, refreshToken: nextToken, expiresIn: this.accessTtlSeconds(), refreshExpiresAt: newRefreshExpiresAt }
  }

  /** Revokes the session identified by the presented refresh token. */
  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return
    await this.prisma.refreshSession
      .updateMany({
        where: { refreshTokenHash: hashRefreshToken(presented), revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      })
      .catch(() => undefined)
  }

  /** Lists the caller's own active sessions (never the token hashes). */
  async listSessions(userId: string) {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
        rotatedFromId: true,
      },
    })
    return { sessions }
  }

  /** Revokes one of the caller's own sessions (404 cross-user, §28). */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    })
    if (!session) throw ApiError.notFound('NOT_FOUND', 'Session not found.')
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    })
  }

  // ------------------------------------------------------------------
  // Password change
  // ------------------------------------------------------------------

  async changePassword(userId: string, input: ChangePasswordInput, meta: AccessMeta): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user?.passwordHash) throw new ApiError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401)

    const ok = await verifyPassword(user.passwordHash, input.currentPassword)
    if (!ok) {
      await this.securityEvent('FAILED_LOGIN', user.id, user.garageId, 'password_change', meta)
      throw new ApiError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401)
    }
    if (!isStrongPassword(input.newPassword)) {
      throw new ApiError('WEAK_PASSWORD', 'Password must be at least 10 characters and include a letter and a number.', 400)
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword) },
      }),
      // Invalidate every OTHER session (the current device stays logged in).
      this.prisma.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ])
  }

  // ------------------------------------------------------------------
  // MFA (TOTP) — ADMIN+ enforced at the controller
  // ------------------------------------------------------------------

  async mfaEnroll(userId: string, accountLabel: string) {
    const existing = await this.prisma.mfaFactor.findFirst({
      where: { userId, type: 'TOTP', disabledAt: null },
      select: { id: true, confirmedAt: true },
    })
    if (existing) {
      throw ApiError.conflict(
        'MFA_ALREADY_ENROLLED',
        existing.confirmedAt ? 'MFA is already enabled for this account.' : 'An MFA enrollment is already pending — verify it or contact an admin.',
      )
    }

    const secret = generateTotpSecret()
    await this.prisma.mfaFactor.create({
      data: { userId, type: 'TOTP', secretEncrypted: await encryptSecret(secret) },
    })
    // otpauth:// URI for QR rendering; the secret itself is shown once.
    return { otpauthUrl: totpUri(secret, accountLabel), secret }
  }

  /** Confirms enrollment with a valid code; factor becomes active. */
  async mfaVerify(userId: string, code: string): Promise<{ confirmed: true }> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, type: 'TOTP', confirmedAt: null, disabledAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!factor) throw ApiError.notFound('NOT_FOUND', 'No pending MFA enrollment.')

    const secret = await decryptSecret(factor.secretEncrypted)
    if (!verifyTotp(secret, code)) throw new ApiError('MFA_INVALID', 'Invalid authenticator code.', 400)

    await this.prisma.$transaction([
      this.prisma.mfaFactor.update({
        where: { id: factor.id },
        data: { confirmedAt: new Date(), lastUsedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnforced: true } }),
    ])
    return { confirmed: true }
  }

  // ------------------------------------------------------------------
  // Token plumbing
  // ------------------------------------------------------------------

  private async signAccessToken(user: User): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      garageId: user.garageId,
      status: user.status,
    })
  }

  private accessTtlSeconds(): number {
    const ttl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m'
    const m = /^(\d+)([smhd])?$/.exec(ttl.trim())
    if (!m) return 900
    const n = Number(m[1])
    const unit = m[2] ?? 's'
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1
    return n * mult
  }

  private refreshTtlMs(): number {
    const ttl = this.config.get<string>('JWT_REFRESH_TTL') ?? '30d'
    const m = /^(\d+)([smhd])?$/.exec(ttl.trim())
    if (!m) return 30 * 86_400_000
    const n = Number(m[1])
    const unit = m[2] ?? 's'
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1
    return n * mult
  }

  private deviceLabel(ua?: string): string | undefined {
    if (!ua) return undefined
    // Very coarse label — enough for the sessions list to be recognizable.
    const os = /Windows/i.test(ua)
      ? 'Windows'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(ua)
          ? 'iOS'
          : /Mac OS X|Macintosh/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Unknown OS'
    const browser = /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome|CriOS/i.test(ua)
        ? 'Chrome'
        : /Firefox/i.test(ua)
          ? 'Firefox'
          : /Safari/i.test(ua)
            ? 'Safari'
            : 'Browser'
    return `${browser} · ${os}`.slice(0, 120)
  }
}
