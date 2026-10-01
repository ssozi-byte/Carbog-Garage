import { Module } from '@nestjs/common'
import { InvoicesController, MpesaCallbackController } from './invoices.controller'
import { InvoicesService } from './invoices.service'
import { MpesaService } from './mpesa.service'
import { AuthModule } from '../auth/auth.module'
import { CommsModule } from '../comms/comms.module'

/**
 * Phase 5E — invoicing & payments (roadmap step 16; database.md §2.16–19).
 * Financials are CASHIER+ (§6); the Daraja callback is the one public route,
 * protected by payload hashing instead of a JWT.
 */
@Module({
  imports: [AuthModule, CommsModule],
  controllers: [InvoicesController, MpesaCallbackController],
  providers: [InvoicesService, MpesaService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
