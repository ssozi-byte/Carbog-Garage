import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { NotificationService } from './notification.service'
import { UpdatesService } from './updates.service'
import { RemindersService } from './reminders.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { broadcastSchema, createReminderSchema, updateReminderSchema, type BroadcastInput, type CreateReminderInput, type UpdateReminderInput } from './dto/comms.dto'

function userId(req: Request): string {
  return (req as Request & { user?: { id: string } }).user!.id
}

/**
 * Comms & reminders (Phase 7, roadmap §8/§16–18):
 *   /notifications     — every user's own inbox (auto events + broadcast fan-outs)
 *   /customer-updates  — manager broadcasts (SERVICE_ADVISOR+ write)
 *   /service-reminders — vehicle maintenance nudges (SERVICE_ADVISOR+ write)
 * The channels matrix is §8 as data: GET /notifications/channels-matrix.
 */
@ApiTags('comms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CommsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly updates: UpdatesService,
    private readonly reminders: RemindersService,
  ) {}

  // ---------------- Notifications (all roles) ----------------

  /** GET /notifications/channels-matrix — §8 defaults as data (documented first so /mine parses). */
  @Get('notifications/channels-matrix')
  @Roles('CUSTOMER+')
  channelsMatrix() {
    return this.notifications.matrix()
  }

  /** GET /notifications/mine?unreadOnly=true — the customer-app inbox. */
  @Get('notifications/mine')
  @Roles('CUSTOMER+')
  mine(@Req() req: Request, @Query('unreadOnly') unreadOnly?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.notifications.mine(userId(req), unreadOnly === 'true', Number(page), Number(limit))
  }

  /** POST /notifications/:id/read — mark my own row read (foreign id → 404). */
  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.OK)
  @Roles('CUSTOMER+')
  markRead(@Param('id') id: string, @Req() req: Request) {
    return this.notifications.markRead(userId(req), id)
  }

  // ---------------- Manager broadcasts (§16) ----------------

  /** GET /customer-updates — broadcast history for managers. */
  @Get('customer-updates')
  @Roles('SERVICE_ADVISOR+')
  listUpdates(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.updates.list(Number(page), Number(limit))
  }

  /** POST /customer-updates — manager broadcast; fans out via the one writer. */
  @Post('customer-updates')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SERVICE_ADVISOR+')
  broadcast(@Body(new ZodValidationPipe(broadcastSchema)) body: BroadcastInput, @Req() req: Request) {
    return this.updates.broadcast(body, userId(req))
  }

  // ---------------- Service reminders (§18) ----------------

  /** GET /service-reminders?status=DUE — the advisor reminder queue. */
  @Get('service-reminders')
  @Roles('SERVICE_ADVISOR+')
  listReminders(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.reminders.list(status, Number(page), Number(limit))
  }

  @Post('service-reminders')
  @HttpCode(HttpStatus.CREATED)
  @Roles('SERVICE_ADVISOR+')
  createReminder(@Body(new ZodValidationPipe(createReminderSchema)) body: CreateReminderInput, @Req() req: Request) {
    return this.reminders.create(body, userId(req))
  }

  @Patch('service-reminders/:id')
  @Roles('SERVICE_ADVISOR+')
  updateReminder(@Param('id') id: string, @Body(new ZodValidationPipe(updateReminderSchema)) body: UpdateReminderInput) {
    return this.reminders.update(id, body)
  }

  /** POST /service-reminders/:id/send — fires the notification (idempotent on the inbox). */
  @Post('service-reminders/:id/send')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR+')
  sendReminder(@Param('id') id: string, @Req() req: Request) {
    return this.reminders.send(id, userId(req))
  }
}
