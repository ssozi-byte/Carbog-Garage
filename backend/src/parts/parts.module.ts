import { Module } from '@nestjs/common'
import { PartsController, PartRequestsController } from './parts.controller'
import { PartsService } from './parts.service'
import { AuthModule } from '../auth/auth.module'

/**
 * Phase 5D — parts & inventory. The storekeeper's world: catalog, stock
 * ledger, and the parts_requests queue whose issue step is the only code
 * path that decrements stock (always paired with its ledger row).
 */
@Module({
  imports: [AuthModule],
  controllers: [PartsController, PartRequestsController],
  providers: [PartsService],
  exports: [PartsService],
})
export class PartsModule {}
