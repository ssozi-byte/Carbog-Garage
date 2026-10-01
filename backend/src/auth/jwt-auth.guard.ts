import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { PrismaService } from '../database/prisma.service'
import { setRequestUser } from '../common/context/request-context'
import { ApiError } from '../common/errors/error-codes'

export interface AuthedUser {
  id: string
  role: string
  garageId: string | null
  firstName: string
  lastName: string
  phone: string
  email: string | null
  status: string
  mfaEnforced: boolean
}

/**
 * Verifies the Bearer access token, loads the live user row, and enforces
 * account state (ACTIVE, not deleted/locked) — a stolen-but-valid token dies
 * here the moment the account is suspended. Populates req.user and the
 * AsyncLocalStorage request context for log correlation (§37).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Authentication required.')
    }
    const token = header.slice(7).trim()
    if (!token) throw ApiError.unauthorized('Authentication required.')

    let payload: { sub?: string }
    try {
      payload = await this.jwt.verifyAsync(token)
    } catch {
      throw new ApiError('TOKEN_EXPIRED', 'Access token is invalid or expired.', 401)
    }
    if (!payload.sub) throw new ApiError('TOKEN_EXPIRED', 'Access token is invalid or expired.', 401)

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        role: true,
        garageId: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        mfaEnforced: true,
      },
    })
    if (!user) throw ApiError.unauthorized('Account not found.')
    if (user.status === 'SUSPENDED' || user.status === 'LOCKED') {
      throw ApiError.forbidden('Account is suspended. Contact an administrator.')
    }

    ;(req as Request & { user?: AuthedUser }).user = user
    setRequestUser({ id: user.id, role: user.role, garageId: user.garageId })
    return true
  }
}
