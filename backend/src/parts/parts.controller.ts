import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { PartsService } from './parts.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import {
  adjustStockSchema,
  cancelPartRequestSchema,
  createPartRequestSchema,
  createPartSchema,
  listPartsQuerySchema,
  listRequestsQuerySchema,
  orderPartRequestSchema,
  updatePartSchema,
  type AdjustStockInput,
  type CreatePartInput,
  type CreatePartRequestInput,
  type ListPartsQuery,
  type ListRequestsQuery,
  type UpdatePartInput,
} from './dto/part.dto'
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
 * Parts catalog + stock ledger (Phase 5D). Roadmap §6 matrix: mechanics READ
 * parts; only INVENTORY_MANAGER/ADMIN+ write stock — hence the exact role
 * lists on every mutating route (a plain `+` suffix would let SA/CASHIER
 * through, since both rank equal to INVENTORY_MANAGER).
 */
@ApiTags('parts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PartsController {
  constructor(private readonly parts: PartsService) {}

  @Post('parts')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  create(@Body(new ZodValidationPipe(createPartSchema)) body: CreatePartInput, @Req() req: Request) {
    return this.parts.createPart(body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  @Patch('parts/:id')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePartSchema)) body: UpdatePartInput,
    @Req() req: Request,
  ) {
    return this.parts.updatePart(id, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  @Get('parts')
  @Roles('MECHANIC+')
  list(@Query(new ZodValidationPipe(listPartsQuerySchema)) query: ListPartsQuery) {
    return this.parts.listParts(query)
  }

  @Get('parts/:id')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  get(@Param('id') id: string) {
    return this.parts.getPart(id)
  }

  /** Manual stock movement — always paired with an append-only ledger row. */
  @Post('parts/:id/adjust')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStockInput,
    @Req() req: Request,
  ) {
    return this.parts.adjustStock(id, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  @Get('inventory/transactions')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  transactions(@Query('partId') partId?: string) {
    return this.parts.listTransactions(partId)
  }
}

/**
 * Parts requests (roadmap §5 step 12–13): the mechanic asks, the storekeeper
 * decides. Mechanics may only request against their own assigned jobs;
 * issuing decrements stock and writes the ledger row in one transaction.
 */
@ApiTags('parts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PartRequestsController {
  constructor(private readonly parts: PartsService) {}

  /** Mechanic asks for a part on their job card (→ WAITING_PARTS). */
  @Post('work-orders/:woNumber/parts-requests')
  @Roles('MECHANIC+')
  create(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(createPartRequestSchema)) body: CreatePartRequestInput,
    @Req() req: Request,
  ) {
    const u = (req as Request & { user?: { id: string; role: string } }).user!
    return this.parts.createRequest(woNumber, body, { id: u.id, role: u.role }, requestMeta(req))
  }

  @Get('work-orders/:woNumber/parts-requests')
  @Roles('MECHANIC+')
  listForWorkOrder(@Param('woNumber') woNumber: string, @Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery) {
    return this.parts.listRequests(query, woNumber)
  }

  /** Storekeeper queue. */
  @Get('parts-requests')
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  list(@Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery) {
    return this.parts.listRequests(query)
  }

  @Get('parts-requests/:id')
  @Roles('MECHANIC+')
  get(@Param('id') id: string) {
    return this.parts.getRequest(id)
  }

  /** THE issue step: stock −N + ledger row + request → ISSUED, one tx. */
  @Post('parts-requests/:id/issue')
  @HttpCode(HttpStatus.OK)
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  issue(@Param('id') id: string, @Req() req: Request) {
    return this.parts.issueRequest(id, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  /** Nothing on the shelf → flag ORDERED (procurement); stock untouched. */
  @Post('parts-requests/:id/order')
  @HttpCode(HttpStatus.OK)
  @Roles('INVENTORY_MANAGER', 'ADMIN', 'SUPER_ADMIN')
  order(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderPartRequestSchema)) body: { supplierRef?: string; note?: string },
    @Req() req: Request,
  ) {
    return this.parts.orderRequest(id, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }

  /** Requester/staff abort — only while still REQUESTED. */
  @Post('parts-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('MECHANIC+')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelPartRequestSchema)) body: { note?: string },
    @Req() req: Request,
  ) {
    return this.parts.cancelRequest(id, body, { id: (req as Request & { user?: { id: string } }).user!.id })
  }
}
