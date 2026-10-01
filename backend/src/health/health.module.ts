import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { PinoLogger } from './pino.logger'

export const PINO_LOGGER = Symbol('PINO_LOGGER')

@Module({
  controllers: [HealthController],
  // Class token (for constructor injection) + symbol token (for cross-module use)
  providers: [PinoLogger, { provide: PINO_LOGGER, useExisting: PinoLogger }],
  exports: [PINO_LOGGER],
})
export class HealthModule {}
