import { Module } from '@nestjs/common'
import { WorkOrdersController } from './work-orders.controller'
import { WorkOrdersService } from './work-orders.service'
import { AuthModule } from '../auth/auth.module'
import { CommsModule } from '../comms/comms.module'

/**
 * Phase 5A — work orders (the job card). BookingsModule imports this to
 * spawn work orders inside its check-in transaction; AuthModule provides
 * JwtModule for the guards used on the controller routes.
 */
@Module({
  imports: [AuthModule, CommsModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
