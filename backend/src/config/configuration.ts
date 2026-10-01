import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { validateEnv, type Env } from './env.schema'

/**
 * Typed, validated configuration. Every module reads config through this —
 * raw process.env access outside this module is a review failure.
 */
export function getEnv(configService: ConfigService<Env, true>): Env {
  return {
    NODE_ENV: configService.get('NODE_ENV', { infer: true }),
    PORT: configService.get('PORT', { infer: true }),
    FRONTEND_URL: configService.get('FRONTEND_URL', { infer: true }),
    EXTRA_CORS_ORIGINS: configService.get('EXTRA_CORS_ORIGINS', { infer: true }),
    LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
    DATABASE_URL: configService.get('DATABASE_URL', { infer: true }),
    REDIS_URL: configService.get('REDIS_URL', { infer: true }),
    JWT_ACCESS_SECRET: configService.get('JWT_ACCESS_SECRET', { infer: true }),
    JWT_REFRESH_SECRET: configService.get('JWT_REFRESH_SECRET', { infer: true }),
    JWT_ACCESS_TTL: configService.get('JWT_ACCESS_TTL', { infer: true }),
    JWT_REFRESH_TTL: configService.get('JWT_REFRESH_TTL', { infer: true }),
    MPESA_ENV: configService.get('MPESA_ENV', { infer: true }),
    MPESA_CONSUMER_KEY: configService.get('MPESA_CONSUMER_KEY', { infer: true }),
    MPESA_CONSUMER_SECRET: configService.get('MPESA_CONSUMER_SECRET', { infer: true }),
    MPESA_SHORTCODE: configService.get('MPESA_SHORTCODE', { infer: true }),
    MPESA_PASSKEY: configService.get('MPESA_PASSKEY', { infer: true }),
    MPESA_CALLBACK_URL: configService.get('MPESA_CALLBACK_URL', { infer: true }),
    SMS_API_KEY: configService.get('SMS_API_KEY', { infer: true }),
    WHATSAPP_API_KEY: configService.get('WHATSAPP_API_KEY', { infer: true }),
    S3_ENDPOINT: configService.get('S3_ENDPOINT', { infer: true }),
    S3_ACCESS_KEY: configService.get('S3_ACCESS_KEY', { infer: true }),
    S3_SECRET_KEY: configService.get('S3_SECRET_KEY', { infer: true }),
    S3_BUCKET: configService.get('S3_BUCKET', { infer: true }),
    S3_REGION: configService.get('S3_REGION', { infer: true }),
  }
}

export function corsOrigins(env: Env): string[] {
  const extras = (env.EXTRA_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [env.FRONTEND_URL, ...extras]
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppConfigModule {}
