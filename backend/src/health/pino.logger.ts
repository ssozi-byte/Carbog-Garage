import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Logger as PinoClient } from 'pino'
import { buildPinoLogger } from '../common/logging/pino-logger'
import type { Env } from '../config/env.schema'

@Injectable()
export class PinoLogger implements OnModuleInit, OnModuleDestroy {
  private client!: PinoClient

  init(env: Env) {
    this.client = buildPinoLogger(env)
    ;(globalThis as unknown as { __motoraLogger?: PinoClient }).__motoraLogger = this.client
  }

  onModuleInit() {
    if (!this.client) {
      this.client = buildPinoLogger({
        NODE_ENV: 'development',
        LOG_LEVEL: 'info',
      } as Env)
      ;(globalThis as unknown as { __motoraLogger?: PinoClient }).__motoraLogger = this.client
    }
  }

  /** Never crash request handling because logging failed to init. */
  private ensureClient(): PinoClient {
    if (!this.client) this.onModuleInit()
    return this.client
  }

  info(msg: string, obj?: Record<string, unknown>) {
    this.ensureClient().info(obj ?? {}, msg)
  }
  warn(msg: string, obj?: Record<string, unknown>) {
    this.ensureClient().warn(obj ?? {}, msg)
  }
  error(msg: string, obj?: Record<string, unknown>) {
    this.ensureClient().error(obj ?? {}, msg)
  }
  debug(msg: string, obj?: Record<string, unknown>) {
    this.ensureClient().debug(obj ?? {}, msg)
  }

  onModuleDestroy() {
    this.client?.flush?.()
  }
}
