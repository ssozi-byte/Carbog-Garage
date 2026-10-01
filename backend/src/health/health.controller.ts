import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'
import { PinoLogger } from './pino.logger'

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'motora-api', time: new Date().toISOString() }
  }

  @Get('health/live')
  live() {
    return { status: 'ok' }
  }

  @Get('health/ready')
  async ready() {
    try {
      const db = await this.prisma.ping()
      // Phase 8: add Redis ping alongside the DB probe.
      return {
        status: 'ok',
        checks: { app: 'ok', database: 'ok', dbLatencyMs: db.latencyMs, redis: 'deferred_phase8' },
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.error('Database readiness check failed', { error: detail })
      return {
        status: 'degraded',
        checks: {
          app: 'ok',
          database: 'unreachable',
          // Dev/debug aid only — stripped in production responses.
          ...(process.env.NODE_ENV === 'production' ? {} : { detail }),
        },
      }
    }
  }
}
