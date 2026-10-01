import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { getRequestContext } from '../context/request-context'

export interface RateLimitOptions {
  windowMs: number
  max: number
  message: string
}

/**
 * Fixed-window, in-process limiter (Spec §33). One instance = one bucket
 * namespace, so the public-content limiter and the stricter booking
 * limiter never interfere. Redis-backed when we go multi-instance (Phase 8).
 */
export function createRateLimitMiddleware(opts: RateLimitOptions) {
  @Injectable()
  class RateLimitMiddleware implements NestMiddleware {
    private buckets = new Map<string, { count: number; windowStart: number }>()

    use(req: Request, res: Response, next: NextFunction) {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
      const now = Date.now()
      let bucket = this.buckets.get(ip)

      if (!bucket || now - bucket.windowStart >= opts.windowMs) {
        bucket = { count: 0, windowStart: now }
        this.buckets.set(ip, bucket)
        if (this.buckets.size > 10_000) {
          for (const [k, b] of this.buckets) {
            if (now - b.windowStart >= opts.windowMs) this.buckets.delete(k)
          }
        }
      }

      bucket.count += 1
      if (bucket.count > opts.max) {
        res.setHeader('Retry-After', Math.ceil((bucket.windowStart + opts.windowMs - now) / 1000))
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: opts.message,
            requestId: getRequestContext()?.requestId ?? 'unknown',
          },
        })
        return
      }
      next()
    }
  }
  return RateLimitMiddleware
}

/** Public content reads: 120/min/IP (Spec §41). */
export const PublicRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 120,
  message: 'Too many requests. Please slow down.',
})

/** Guest booking requests: 3/10min/IP (Spec §33 — stricter for conversions). */
export const BookingQuoteRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 600_000,
  max: 3,
  message: 'Too many booking requests. Please call or WhatsApp us instead.',
})

/**
 * Login: coarse per-IP backstop (§13.5). The CONTRACT limit — 5 failures per
 * 15 min per IP+identifier — is enforced in AuthService via login_attempts,
 * which returns ACCOUNT_LOCKED/RATE_LIMITED semantics; this middleware only
 * absorbs credential-stuffing bursts from a single address.
 */
export const AuthLoginRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 15 * 60_000,
  max: 20,
  message: 'Too many login attempts from this network. Please wait 15 minutes.',
})

/** Registration: 3/h/IP (§13.5). */
export const AuthRegisterRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 3_600_000,
  max: 3,
  message: 'Too many accounts created from this network. Please try again later.',
})

/** Refresh rotation: 30/min/IP (api-contract §1). */
export const AuthRefreshRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 30,
  message: 'Too many refresh attempts. Please slow down.',
})

/** OTP request/verify: 10/10min/IP backstop over the per-phone DB throttle. */
export const AuthOtpRateLimitMiddleware = createRateLimitMiddleware({
  windowMs: 600_000,
  max: 10,
  message: 'Too many code requests. Please wait before trying again.',
})
