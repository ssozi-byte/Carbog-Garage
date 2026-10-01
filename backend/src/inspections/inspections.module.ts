import { Module } from '@nestjs/common'
import { InspectionsController, FindingsController } from './inspections.controller'
import { InspectionsService } from './inspections.service'
import { MediaController } from '../media/media.controller'
import { MediaService } from '../media/media.service'
import { AuthModule } from '../auth/auth.module'

/**
 * Phase 5B — inspections & media. Findings live in the same module because
 * they are the customer-facing projection of inspection results.
 */
@Module({
  imports: [AuthModule],
  controllers: [InspectionsController, FindingsController],
  providers: [InspectionsService],
  exports: [InspectionsService],
})
export class InspectionsModule {}

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
