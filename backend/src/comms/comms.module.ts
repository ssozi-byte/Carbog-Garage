import { Module } from '@nestjs/common'
import { CommsController } from './comms.controller'
import { NotificationService } from './notification.service'
import { UpdatesService } from './updates.service'
import { RemindersService } from './reminders.service'
import { AuthModule } from '../auth/auth.module'

/** Phase 7 — comms & reminders (docs/platform-roadmap-v2.md §8, §16–18). Prisma is global. */
@Module({
  imports: [AuthModule],
  controllers: [CommsController],
  providers: [NotificationService, UpdatesService, RemindersService],
  exports: [NotificationService],
})
export class CommsModule {}
