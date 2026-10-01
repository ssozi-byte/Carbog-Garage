import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { BookingsService, type TransitionMeta } from './bookings.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import { quoteRequestSchema, QuoteRequestDto, QuoteRequestResponseDto } from './dto/quote-request.dto'
import {
  confirmBookingSchema,
  statusChangeSchema,
  cancelBookingSchema,
  ConfirmBookingDto,
  StatusChangeDto,
  CancelBookingDto,
} from './dto/transition.dto'
import type { BookingStatus } from '@prisma/client'

function requestMeta(req: Request): TransitionMeta {
  const user = (req as Request & { user?: { id: string } }).user
  return {
    actorId: user?.id,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
    requestId: req.headers['x-request-id'] as string | undefined,
  }
}

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  // ---- Public (guest) --------------------------------------------------

  /** Guest quote request — powers the existing ContactPage form (Spec §43). */
  @Post('quote-request')
  @ApiBody({ type: QuoteRequestDto })
  @ApiOkResponse({ type: QuoteRequestResponseDto })
  async createQuoteRequest(
    @Body(new ZodValidationPipe(quoteRequestSchema)) body: QuoteRequestDto,
    @Req() req: Request,
  ): Promise<QuoteRequestResponseDto> {
    return this.bookings.createQuoteRequest(body, requestMeta(req))
  }

  // ---- Staff (JWT + RBAC; Phase 3) ---------------------------------------

  /** Transition-table view for staff UIs. */
  @Get('status-machine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+', 'MECHANIC')
  statusMachine() {
    return { transitions: this.bookings.allowedTransitions() }
  }

  /** Paginated booking list; `?status=REQUESTED` filters. */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+', 'MECHANIC')
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const p = Number.parseInt(page ?? '1', 10) || 1
    const l = Number.parseInt(limit ?? '20', 10) || 20
    const st = status as BookingStatus | undefined
    return this.bookings.listBookings(p, l, st)
  }

  /** Full detail incl. status history. */
  @Get(':bookingNumber')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+', 'MECHANIC')
  getByNumber(@Param('bookingNumber') bookingNumber: string) {
    return this.bookings.getBookingByNumber(bookingNumber)
  }

  /** REQUESTED → CONFIRMED with the agreed slot (§30 example flow). */
  @Post(':bookingNumber/confirm')
  @HttpCode(HttpStatus.OK) // transitions are updates, not creations
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+')
  @ApiBody({ type: ConfirmBookingDto })
  confirm(
    @Param('bookingNumber') bookingNumber: string,
    @Body(new ZodValidationPipe(confirmBookingSchema)) body: ConfirmBookingDto & { reason?: string },
    @Req() req: Request,
  ) {
    return this.bookings.confirm(bookingNumber, { ...requestMeta(req), ...body })
  }

  /** CONFIRMED → CHECKED_IN. */
  @Post(':bookingNumber/check-in')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+')
  checkIn(
    @Param('bookingNumber') bookingNumber: string,
    @Body(new ZodValidationPipe(statusChangeSchema.partial({ status: true }))) body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.bookings.checkIn(bookingNumber, { ...requestMeta(req), ...body })
  }

  /** Any legal transition except CONFIRMED/CHECKED_IN/CANCELLED shortcuts. */
  @Patch(':bookingNumber/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+')
  @ApiBody({ type: StatusChangeDto })
  changeStatus(
    @Param('bookingNumber') bookingNumber: string,
    @Body(new ZodValidationPipe(statusChangeSchema)) body: StatusChangeDto,
    @Req() req: Request,
  ) {
    return this.bookings.transition(bookingNumber, body.status as BookingStatus, {
      ...requestMeta(req),
      reason: body.reason,
    })
  }

  /** Staff-initiated cancellation with mandatory reason. */
  @Post(':bookingNumber/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SERVICE_ADVISOR+')
  @ApiBody({ type: CancelBookingDto })
  cancel(
    @Param('bookingNumber') bookingNumber: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingDto,
    @Req() req: Request,
  ) {
    return this.bookings.cancel(bookingNumber, body.reason, requestMeta(req))
  }
}
