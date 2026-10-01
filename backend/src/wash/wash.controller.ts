import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards, Headers } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { WashService } from './wash.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { washStepSchema, type WashStepInput } from './dto/wash.dto'

function requestMeta(req: Request) {
  return {
    actorId: (req as Request & { user?: { id: string; role?: string } }).user?.id,
    actorRole: (req as Request & { user?: { role?: string } }).user?.role,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
    requestId: req.headers['x-request-id'] as string | undefined,
  }
}

/**
 * Car wash (Phase 6) — the washer's five-button UI made API (§2.2).
 * Reads are MECHANIC+ (washer rank-equal); assignment is SERVICE_ADVISOR+
 * (washers may self-claim); every step press is a washer action.
 */
@ApiTags('wash')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wash-jobs')
export class WashController {
  constructor(private readonly wash: WashService) {}

  /** Live wash board — the queue the washer bay screen shows. */
  @Get()
  @Roles('MECHANIC+')
  board() {
    return this.wash.board()
  }

  /** The signed-in washer's own open jobs. */
  @Get('my-today')
  @Roles('WASHER+')
  myToday(@Req() req: Request) {
    const user = (req as Request & { user?: { id: string } }).user
    return this.wash.myToday(user!.id)
  }

  /** Full job detail incl. step history + allowed next steps. */
  @Get(':woNumber')
  @Roles('MECHANIC+')
  getJob(@Param('woNumber') woNumber: string) {
    return this.wash.getJob(woNumber)
  }

  /** Assign (or self-claim) the washer driving this wash. */
  @Post(':woNumber/assign')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR+', 'WASHER')
  assign(@Param('woNumber') woNumber: string, @Body() body: { washerId: string }, @Req() req: Request) {
    return this.wash.assign(woNumber, body.washerId, requestMeta(req))
  }

  /**
   * One press: advance the step machine. `X-Event-Id` (client UUID) makes
   * offline replays a no-op — the same event id returns the same state.
   */
  @Post(':woNumber/step')
  @HttpCode(HttpStatus.OK)
  @Roles('WASHER', 'MECHANIC', 'SERVICE_ADVISOR', 'ADMIN', 'SUPER_ADMIN')
  step(
    @Param('woNumber') woNumber: string,
    @Headers('x-event-id') eventId: string | undefined,
    @Body(new ZodValidationPipe(washStepSchema)) body: WashStepInput,
    @Req() req: Request,
  ) {
    return this.wash.step(woNumber, body, eventId, requestMeta(req))
  }
}
