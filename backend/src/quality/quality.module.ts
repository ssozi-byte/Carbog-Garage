import { Module } from '@nestjs/common'
import { QualityController } from './quality.controller'
import { QualityService } from './quality.service'
import { AuthModule } from '../auth/auth.module'

/** Phase 5E — quality control (roadmap §15). The gate itself lives in
 * WorkOrdersService.transition; this module owns the checklist lifecycle. */
@Module({
  imports: [AuthModule],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
