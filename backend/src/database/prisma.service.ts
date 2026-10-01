import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

/**
 * Singleton Prisma client for the whole app (modular monolith — one pool).
 * Transactions and tenant-scoped queries go through this instance.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }

  /** Cheap readiness probe used by /health/ready. */
  async ping(): Promise<{ database: string; latencyMs: number }> {
    const start = Date.now()
    await this.$queryRaw`SELECT 1`
    return { database: 'ok', latencyMs: Date.now() - start }
  }
}
