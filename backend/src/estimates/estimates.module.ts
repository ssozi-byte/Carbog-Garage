import { Module } from '@nestjs/common'
import { WorkOrderEstimatesController, EstimateActionsController, EstimateApprovalController } from './estimates.controller'
import { EstimatesService } from './estimates.service'
import { AuthModule } from '../auth/auth.module'
import { CommsModule } from '../comms/comms.module'

/**
 * Phase 5C — estimates & approvals. The customer-facing approval controller
 * is intentionally public (OTP is the credential); the staff controller rides
 * the standard JWT+RBAC guards.
 */
@Module({
  imports: [AuthModule, CommsModule],
  controllers: [WorkOrderEstimatesController, EstimateActionsController, EstimateApprovalController],
  providers: [EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
