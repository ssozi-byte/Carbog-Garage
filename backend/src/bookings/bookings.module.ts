import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { BookingsController } from './bookings.controller'
import { BookingsService } from './bookings.service'
import { BookingQuoteRateLimitMiddleware } from '../common/middleware/rate-limit.factory'
import { AuthModule } from '../auth/auth.module'
import { WorkOrdersModule } from '../work-orders/work-orders.module'
import { CommsModule } from '../comms/comms.module'

@Module({
  // AuthModule exports JwtModule (guards); WorkOrdersService spawns the job
  // card inside the check-in transaction (Phase 5A).
  imports: [AuthModule, WorkOrdersModule, CommsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 3 requests / 10 min / IP (Spec §33) — guest conversion endpoints get
    // stricter limits than public reads.
    consumer.apply(BookingQuoteRateLimitMiddleware).forRoutes('bookings/quote-request')
  }
}
