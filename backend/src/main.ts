import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'
import { corsOrigins } from './config/configuration'
import type { Env } from './config/env.schema'
import { RequestCtxMiddleware } from './common/middleware/request-context.middleware'
import { PinoLogger } from './health/pino.logger'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Env was validated by ConfigModule at boot; read typed values here.
  const configService = app.get(ConfigService<Env, true>)
  const env = {
    NODE_ENV: configService.get('NODE_ENV', { infer: true }),
    PORT: configService.get('PORT', { infer: true }),
    FRONTEND_URL: configService.get('FRONTEND_URL', { infer: true }),
    EXTRA_CORS_ORIGINS: configService.get('EXTRA_CORS_ORIGINS', { infer: true }),
    LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
    DATABASE_URL: configService.get('DATABASE_URL', 'postgresql://', { infer: true }),
    REDIS_URL: configService.get('REDIS_URL', 'redis://', { infer: true }),
  } as Env

  const logger = app.get(PinoLogger)
  logger.init(env)

  // Security & platform middleware
  app.use(helmet())
  app.use(compression())
  app.use(cookieParser())
  const requestCtx = new RequestCtxMiddleware()
  app.use((req: Request, res: Response, next: NextFunction) => requestCtx.use(req, res, next))

  // CORS — explicit allow-list only (Spec §34). No wildcard, ever.
  const origins = corsOrigins(env)
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })

  // Global API prefix; health endpoints stay at root for LB probes.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] })

  // Body-size guard (Spec §33).
  app.use(express.json({ limit: '1mb' }))

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MOTORA API')
    .setDescription('MOTORA Garage platform — v1')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('docs', app, document)

  app.enableShutdownHooks()

  await app.listen(env.PORT, '0.0.0.0')
  logger.info(`MOTORA API listening on :${env.PORT}`, {
    env: env.NODE_ENV,
    cors: origins,
    swagger: '/docs',
  })
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err)
  process.exit(1)
})
