import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Env } from '../config/env.schema'
import { AuthService } from './auth.service'
import { OtpService } from './otp.service'
import { AuthController } from './auth.controller'
import {
  AuthLoginRateLimitMiddleware,
  AuthOtpRateLimitMiddleware,
  AuthRefreshRateLimitMiddleware,
  AuthRegisterRateLimitMiddleware,
} from '../common/middleware/rate-limit.factory'

/**
 * Phase 3 auth: JWT access tokens + rotating refresh sessions, Argon2id
 * passwords, RBAC guards, login throttling and TOTP MFA (api-contract §1).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
  exports: [AuthService, OtpService, JwtModule],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Route-class limits (§13.5): register 3/h/IP, login 5/15min/IP,
    // refresh 30/min/IP. Identifier-level login throttling (5 failures
    // per phone/email) lives in AuthService via login_attempts.
    consumer
      .apply(AuthRegisterRateLimitMiddleware)
      .forRoutes('auth/register')
      .apply(AuthLoginRateLimitMiddleware)
      .forRoutes('auth/login')
      .apply(AuthRefreshRateLimitMiddleware)
      .forRoutes('auth/refresh')
      .apply(AuthOtpRateLimitMiddleware)
      .forRoutes('auth/otp/request', 'auth/otp/verify')
  }
}
