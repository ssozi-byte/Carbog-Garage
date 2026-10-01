import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { InvoicesService } from './invoices.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import {
  composeInvoiceSchema,
  createPaymentSchema,
  voidInvoiceSchema,
  type ComposeInvoiceInput,
  type CreatePaymentInput,
  type VoidInvoiceInput,
} from './dto/invoice.dto'

/**
 * Invoices & payments (Phase 5E). Roadmap §6: financials are CASHIER+ —
 * compose/issue/void and every payment route sit behind CASHIER (with
 * ADMIN+ inheriting via the rank ladder). The Daraja callback alone is
 * public: Safaricom's servers hold no JWT; replay protection is the
 * payload hash + unique external event id, not auth.
 */
@ApiTags('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** Compose/recompose the WO invoice from the APPROVED estimate + issued parts. */
  @Post('work-orders/:woNumber/invoice')
  @HttpCode(HttpStatus.OK)
  @Roles('CASHIER+')
  compose(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(composeInvoiceSchema)) body: ComposeInvoiceInput,
    @Req() req: Request,
  ) {
    return this.invoices.compose(woNumber, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  @Get('work-orders/:woNumber/invoice')
  @Roles('CASHIER+')
  forWorkOrder(@Param('woNumber') woNumber: string) {
    return this.invoices.getForWorkOrder(woNumber)
  }

  /** DRAFT → ISSUED: totals frozen, paper leaves the building. */
  @Post('invoices/:invoiceNumber/issue')
  @HttpCode(HttpStatus.OK)
  @Roles('CASHIER+')
  issue(@Param('invoiceNumber') invoiceNumber: string, @Req() req: Request) {
    return this.invoices.issue(invoiceNumber, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  /** Corrections = VOID + reason (never delete, never edit). */
  @Post('invoices/:invoiceNumber/void')
  @HttpCode(HttpStatus.OK)
  @Roles('CASHIER+')
  void(
    @Param('invoiceNumber') invoiceNumber: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) body: VoidInvoiceInput,
    @Req() req: Request,
  ) {
    return this.invoices.void(invoiceNumber, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  @Get('invoices')
  @Roles('CASHIER+')
  list(@Query('status') status?: string) {
    return this.invoices.list(status)
  }

  @Get('invoices/:invoiceNumber')
  @Roles('CASHIER+')
  get(@Param('invoiceNumber') invoiceNumber: string) {
    return this.invoices.get(invoiceNumber)
  }

  /** Counter payment (CASH completes immediately) or MPESA STK initiation. */
  @Post('invoices/:invoiceNumber/payments')
  @HttpCode(HttpStatus.OK)
  @Roles('CASHIER+')
  pay(
    @Param('invoiceNumber') invoiceNumber: string,
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
    @Req() req: Request,
  ) {
    return this.invoices.createPayment(invoiceNumber, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  /** Corrections are new rows — reverse a completed payment. */
  @Post('payments/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles('CASHIER+')
  reverse(@Param('id') id: string, @Req() req: Request) {
    return this.invoices.reversePayment(id, { id: (req as Request & { user?: { id: string } }).user!.id })
  }
}

/** Public Daraja callback (Safaricom servers cannot hold a JWT). */
@ApiTags('invoices')
@Controller('payments')
export class MpesaCallbackController {
  constructor(private readonly invoices: InvoicesService) {}

  /**
   * Daraja posts the STK result here. The express.json body parser has
   * already consumed the stream, so the replay hash is taken over the
   * deterministic re-serialization of the parsed body — identical payloads
   * hash identically, which is all replay detection needs.
   */
  @Post('mpesa/callback')
  @HttpCode(HttpStatus.OK)
  async callback(@Req() req: Request) {
    const body = (req as Request & { body?: unknown }).body
    const raw = typeof body === 'string' ? body : JSON.stringify(body ?? null)
    return this.invoices.handleMpesaCallback(raw)
  }
}
