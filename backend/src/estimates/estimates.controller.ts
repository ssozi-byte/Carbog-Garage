import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { EstimatesService } from './estimates.service'
import { OtpService } from '../auth/otp.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { ApiError } from '../common/errors/error-codes'
import { z } from 'zod'
import {
  createEstimateSchema,
  declineEstimateSchema,
  otpDecisionSchema,
  type CreateEstimateInput,
  type DeclineEstimateInput,
  type OtpDecisionInput,
} from './dto/estimate.dto'
import type { TransitionMeta } from '../bookings/bookings.service'

const otpRequestPhoneSchema = z.object({ phone: z.string().trim().min(9).max(20) })

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
 * Staff estimate routes (Phase 5C). SERVICE_ADVISOR+ builds and sends;
 * CASHIER+ issues invoices later (5E) — creation ≠ money. One estimate per
 * work order; totals are recomputed server-side from the item lines.
 */
@ApiTags('estimates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('work-orders')
export class WorkOrderEstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  /** Build (or rebuild the draft of) the work order's estimate — SA+. */
  @Post(':woNumber/estimates')
  @Roles('SERVICE_ADVISOR+')
  create(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(createEstimateSchema)) body: CreateEstimateInput,
    @Req() req: Request,
  ) {
    const u = (req as Request & { user?: { id: string } }).user
    return this.estimates.create(woNumber, body, { id: u!.id })
  }

  /** Staff view: items + append-only approval ledger — SA+. */
  @Get(':woNumber/estimate')
  @Roles('SERVICE_ADVISOR+')
  get(@Param('woNumber') woNumber: string) {
    return this.estimates.getForWorkOrder(woNumber)
  }
}

/**
 * Estimate lifecycle actions. Send is deliberately an exact role list —
 * CASHIER may build an estimate but never sends it (locked decision #2:
 * SERVICE_ADVISOR+ sends; CASHIER+ invoices in 5E).
 */
@ApiTags('estimates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('estimates')
export class EstimateActionsController {
  constructor(private readonly estimates: EstimatesService) {}

  /** DRAFT → SENT + ledger row + OTP challenge to the customer's phone. */
  @Post(':estimateNumber/send')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR', 'INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  send(@Param('estimateNumber') estimateNumber: string, @Req() req: Request) {
    return this.estimates.send(estimateNumber, { id: (req as Request & { user?: { id: string } }).user!.id }, requestMeta(req))
  }

  /** Defer-tracking feed for the Phase 7 reminders engine — SA+. */
  @Get('deferred')
  @Roles('SERVICE_ADVISOR+')
  deferred() {
    return this.estimates.deferredFollowUps()
  }
}

/**
 * OTP-gated customer approval routes (roadmap v2 §10.1) — deliberately public
 * (no JwtAuthGuard): estimates go to guests who may never have registered.
 * The credential is the OTP proof, either a Bearer scope token from
 * /auth/otp/verify or a one-shot {phone, code} body on the decision itself.
 */
@ApiTags('estimates')
@Controller('estimates')
export class EstimateApprovalController {
  constructor(
    private readonly estimates: EstimatesService,
    private readonly otp: OtpService,
  ) {}

  /** Sends a one-time code to the customer's phone (per-phone throttled). */
  @Post(':estimateNumber/otp-request')
  @HttpCode(HttpStatus.OK)
  requestApprovalCode(
    @Param('estimateNumber') estimateNumber: string,
    @Body(new ZodValidationPipe(otpRequestPhoneSchema)) body: { phone: string },
    @Req() req: Request,
  ) {
    return this.estimates.requestApprovalCode(estimateNumber, body.phone, requestMeta(req))
  }

  /**
   * Customer view of their estimate. Phone-only reads are allowed for the
   * SMS-link flow; the server still proves ownership (phone must match the
   * work order's customer) and the first fetch records the VIEWED ledger row.
   */
  @Post(':estimateNumber/view')
  @HttpCode(HttpStatus.OK)
  async view(
    @Param('estimateNumber') estimateNumber: string,
    @Body(new ZodValidationPipe(otpDecisionSchema)) body: OtpDecisionInput,
    @Req() req: Request,
  ) {
    let phone = body.phone
    let scopeEstimateId: string | undefined
    const header = req.headers.authorization
    if (header?.startsWith('Bearer ')) {
      const v = await this.otp.verifyScopeToken(header.slice(7).trim())
      phone = v.phone
      scopeEstimateId = v.scope.estimateId
    }
    if (!phone) throw ApiError.unauthorized('Provide your phone number to view this estimate.')
    return this.estimates.getForCustomer(estimateNumber, phone, scopeEstimateId)
  }

  /** One-shot approve: Bearer scope token OR {phone, code} in the body. */
  @Post(':estimateNumber/approve')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: { $ref: '#/components/schemas/OtpDecisionInput' } })
  async approve(
    @Param('estimateNumber') estimateNumber: string,
    @Body(new ZodValidationPipe(otpDecisionSchema)) body: OtpDecisionInput,
    @Req() req: Request,
  ) {
    const cred = await this.resolveDecisionCredentials(estimateNumber, body, req)
    return this.estimates.approveByOtp(estimateNumber, { ...cred, meta: requestMeta(req) }, { note: body.note })
  }

  /** Decline with reason → covered findings DEFERRED (+ followUpAt hook). */
  @Post(':estimateNumber/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('estimateNumber') estimateNumber: string,
    @Body(new ZodValidationPipe(otpDecisionSchema)) body: OtpDecisionInput,
    @Req() req: Request,
  ) {
    if (!body.reason) throw ApiError.validation('A decline reason is required (TOO_EXPENSIVE, LATER, NEED_INFO or OTHER).')
    const cred = await this.resolveDecisionCredentials(estimateNumber, body, req)
    return this.estimates.declineByOtp(
      estimateNumber,
      { ...cred, meta: requestMeta(req) },
      { reason: body.reason, note: body.note, followUpAt: body.followUpAt },
    )
  }

  /**
   * Decision credentials: a valid OTP scope token on the request, or a
   * one-shot {phone, code} pair (the code is consumed by deciding).
   */
  private async resolveDecisionCredentials(
    estimateNumber: string,
    body: OtpDecisionInput,
    req: Request,
  ): Promise<{ phone: string; scopeEstimateId: string }> {
    const header = req.headers.authorization
    if (header?.startsWith('Bearer ') && !body.code) {
      const v = await this.otp.verifyScopeToken(header.slice(7).trim())
      return { phone: v.phone, scopeEstimateId: v.scope.estimateId }
    }
    if (body.phone && body.code) {
      const r = await this.otp.verifyCode(body.phone, 'ESTIMATE_APPROVAL', body.code, requestMeta(req))
      return { phone: r.phone, scopeEstimateId: r.scope.estimateId }
    }
    throw ApiError.unauthorized('Provide the 6-digit code sent to your phone to decide on this estimate.')
  }
}
