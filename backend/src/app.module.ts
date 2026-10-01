import { Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { AppConfigModule } from './config/configuration'
import { DatabaseModule } from './database/database.module'
import { PublicContentModule } from './public-content/public-content.module'
import { BookingsModule } from './bookings/bookings.module'
import { AuthModule } from './auth/auth.module'
import { WorkOrdersModule } from './work-orders/work-orders.module'
import { InspectionsModule, MediaModule } from './inspections/inspections.module'
import { EstimatesModule } from './estimates/estimates.module'
import { PartsModule } from './parts/parts.module'
import { QualityModule } from './quality/quality.module'
import { InvoicesModule } from './invoices/invoices.module'
import { WashModule } from './wash/wash.module'
import { CommsModule } from './comms/comms.module'
import { HealthModule, PINO_LOGGER } from './health/health.module'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor'

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    WorkOrdersModule,
    InspectionsModule,
    MediaModule,
    EstimatesModule,
    PartsModule,
    QualityModule,
    InvoicesModule,
    WashModule,
    CommsModule,
    PublicContentModule,
    BookingsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
