import { Module } from '@nestjs/common'
import { WashController } from './wash.controller'
import { WashService } from './wash.service'
import { AuthModule } from '../auth/auth.module'
import { CommsModule } from '../comms/comms.module'

/** Phase 6 — car wash (docs/platform-roadmap-v2.md §2.2). Prisma is global. */
@Module({
  imports: [AuthModule, CommsModule],
  controllers: [WashController],
  providers: [WashService],
})
export class WashModule {}
