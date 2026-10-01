import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { InspectionsService } from './inspections.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import {
  promoteFindingSchema,
  findingDecisionSchema,
  reviewFindingSchema,
  upsertResultSchema,
  PromoteFindingDto,
  FindingDecisionDto,
  UpsertResultDto,
  type FindingDecisionInput,
  type PromoteFindingInput,
  type ReviewFindingInput,
  type UpsertResultInput,
} from './dto/inspection.dto'

function actor(req: Request): { id: string; role: string } {
  const u = (req as Request & { user?: { id: string; role: string } }).user
  if (!u) throw new Error('unreachable: guard guarantees user')
  return { id: u.id, role: u.role }
}

/**
 * Inspections (Phase 5B). Mechanics run the checklist on their own jobs;
 * advisors review findings and send them; customers decide on their own
 * job's sent findings. Result writes are idempotent PUTs keyed by a
 * client-generated UUID (offline outbox safe, roadmap §2.4).
 */
@ApiTags('inspections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  /** Starts (or resumes) the inspection run for a work order. */
  @Post('work-orders/:woNumber/inspections')
  @Roles('MECHANIC+')
  startRun(@Param('woNumber') woNumber: string, @Req() req: Request) {
    return this.inspections.startRun(woNumber, actor(req))
  }

  /** Fill-in view: checklist sections + recorded results (mobile renders this). */
  @Get('inspections/:runId')
  @Roles('MECHANIC+')
  getRunForm(@Param('runId') runId: string, @Req() req: Request) {
    return this.inspections.getRunForm(runId, actor(req))
  }

  /** Idempotent result upsert (client-generated :resultId, offline replay-safe). */
  @Put('inspections/:runId/results/:resultId')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC+')
  @ApiBody({ type: UpsertResultDto })
  upsertResult(
    @Param('runId') runId: string,
    @Param('resultId') resultId: string,
    @Body(new ZodValidationPipe(upsertResultSchema)) body: UpsertResultInput,
    @Req() req: Request,
  ) {
    return this.inspections.upsertResult(runId, resultId, body, actor(req))
  }

  /** Submits the run — every checklist item must be recorded. */
  @Post('inspections/:runId/submit')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC+')
  submitRun(@Param('runId') runId: string, @Req() req: Request) {
    return this.inspections.submitRun(runId, actor(req))
  }

  /** Promotes a result (or standalone note) into a customer-facing finding. */
  @Post('inspections/:runId/findings')
  promoteFinding(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(promoteFindingSchema)) body: PromoteFindingInput,
    @Req() req: Request,
  ) {
    return this.inspections.promoteFinding(runId, body, actor(req))
  }

  /** Advisor sends reviewed, customer-visible findings → SENT. */
  @Post('work-orders/:woNumber/findings/send')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR+')
  sendFindings(@Param('woNumber') woNumber: string, @Req() req: Request) {
    return this.inspections.sendFindings(woNumber, actor(req))
  }

  /** Findings for a work order (customers see only their visible ones). */
  @Get('work-orders/:woNumber/findings')
  @Roles('MECHANIC+', 'CUSTOMER')
  listFindings(@Param('woNumber') woNumber: string, @Req() req: Request) {
    return this.inspections.listFindings(woNumber, actor(req))
  }
}

/** Finding review + customer decision. */
@ApiTags('findings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('findings')
export class FindingsController {
  constructor(private readonly inspections: InspectionsService) {}

  /** Advisor review: customer-facing title/explanation + visibility. */
  @Patch(':id')
  @Roles('SERVICE_ADVISOR+')
  review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewFindingSchema)) body: ReviewFindingInput,
    @Req() req: Request,
  ) {
    return this.inspections.reviewFinding(id, body, actor(req))
  }

  /** Customer (or staff on their behalf) approves / declines / defers. */
  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('CUSTOMER', 'SERVICE_ADVISOR+')
  @ApiBody({ type: FindingDecisionDto })
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(findingDecisionSchema)) body: FindingDecisionInput,
    @Req() req: Request,
  ) {
    const { decision, ...rest } = body
    return this.inspections.decideFinding(id, decision, rest, actor(req))
  }
}
