import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { QualityService } from './quality.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { qcDecisionSchema, submitQcSchema, type QcDecisionInput, type SubmitQcInput } from './dto/quality.dto'
import type { TransitionMeta } from '../bookings/bookings.service'

function requestMeta(req: Request): TransitionMeta {
  const user = (req as Request & { user?: { id: string; role: string } }).user
  return {
    actorId: user?.id,
    actorRole: user?.role,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
    requestId: req.headers['x-request-id'] as string | undefined,
  }
}

/**
 * Quality control routes (Phase 5E). Mechanics submit from TESTING on their
 * own jobs; SERVICE_ADVISOR+ reviews — strict version excludes no one for
 * now (single-garage seed), but the decision is always a separate identity
 * from the mechanic who submitted (enforced by the 409 on self-review? no:
 * by role separation — mechanics have no review route).
 */
@ApiTags('quality')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  /** Mechanic submits the fixed checklist from TESTING (step 15). Exact
   * roles: MECHANIC+ would admit every staff rank (cashier ranks above
   * mechanic), and QC submission is a wrench-side act — advisors review. */
  @Post('work-orders/:woNumber/submit-qc')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC', 'ADMIN', 'SUPER_ADMIN')
  submit(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(submitQcSchema)) body: SubmitQcInput,
    @Req() req: Request,
  ) {
    const u = (req as Request & { user?: { id: string; role: string } }).user!
    return this.quality.submit(woNumber, body, { id: u.id, role: u.role }, requestMeta(req))
  }

  /** Advisor queue: checks awaiting review. */
  @Get('quality-checks')
  @Roles('SERVICE_ADVISOR+')
  listPending() {
    return this.quality.listPending()
  }

  @Get('quality-checks/:id')
  @Roles('MECHANIC+')
  get(@Param('id') id: string) {
    return this.quality.getQc(id)
  }

  /** Advisor decision: approve (no body) or reject with a reason. */
  @Post('quality-checks/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR+')
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(qcDecisionSchema)) body: QcDecisionInput,
    @Req() req: Request,
  ) {
    return this.quality.decide(id, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  /** Gate view: does this job currently clear READY_FOR_COLLECTION? */
  @Get('work-orders/:woNumber/qc-gate')
  @Roles('MECHANIC+')
  gate(@Param('woNumber') woNumber: string) {
    return this.quality.gateFor(woNumber)
  }
}
