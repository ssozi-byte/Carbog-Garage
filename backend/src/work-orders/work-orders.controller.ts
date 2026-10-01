import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import type { WorkOrderStatus } from '@prisma/client'
import { WorkOrdersService } from './work-orders.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/roles.guard'
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe'
import {
  woAssignSchema,
  woStatusChangeSchema,
  WoAssignDto,
  WoStatusChangeDto,
  WoStatusChangeInput,
} from './dto/work-order.dto'

const WORKSHOP_TYPES = ['REPAIR', 'SERVICE', 'DIAGNOSTIC', 'INSPECTION_ONLY'] as const
const WASH_TYPES = ['WASH', 'DETAILING'] as const

function requestMeta(req: Request) {
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
 * Work orders (Phase 5A) — the job card. Reads: mechanics see their own
 * pipeline (my-today) and job detail; advisors/managers see the board and
 * the full list. Transitions are legal-move validated and mechanics may
 * only move their own assigned orders (enforced in the service).
 */
@ApiTags('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get('status-machine')
  @Roles('MECHANIC+')
  statusMachine() {
    return { transitions: this.workOrders.allowedTransitions() }
  }

  /** Live workshop board (open REPAIR/SERVICE/DIAGNOSTIC/INSPECTION orders). */
  @Get('board')
  @Roles('SERVICE_ADVISOR+')
  board(@Query('board') board?: string) {
    const types = board === 'wash' ? [...WASH_TYPES] : [...WORKSHOP_TYPES]
    return this.workOrders.board(types)
  }

  /** Signed-in technician's open jobs + completed-today count. */
  @Get('my-today')
  @Roles('MECHANIC+')
  myToday(@Req() req: Request) {
    const user = (req as Request & { user?: { id: string } }).user
    return this.workOrders.myToday(user!.id)
  }

  /** Paginated list; `?status=` `?technicianId=` filters (advisors+). */
  @Get()
  @Roles('SERVICE_ADVISOR+')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('technicianId') technicianId?: string,
  ) {
    const p = Number.parseInt(page ?? '1', 10) || 1
    const l = Number.parseInt(limit ?? '20', 10) || 20
    const st = (status as WorkOrderStatus | undefined) ?? undefined
    return this.workOrders.list(p, l, st, technicianId)
  }

  /** Full detail incl. status history (mechanics+ — garage scoped). */
  @Get(':woNumber')
  @Roles('MECHANIC+')
  getByNumber(@Param('woNumber') woNumber: string) {
    return this.workOrders.getByNumber(woNumber)
  }

  /** Any legal transition `{status, reason?}` (§3 machine). */
  @Patch(':woNumber/status')
  @Roles('MECHANIC+')
  @ApiBody({ type: WoStatusChangeDto })
  changeStatus(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(woStatusChangeSchema)) body: WoStatusChangeInput,
    @Req() req: Request,
  ) {
    return this.workOrders.transition(woNumber, body.status, { ...requestMeta(req), reason: body.reason })
  }

  /** Assign/reassign the technician (advisors+). */
  @Post(':woNumber/assign')
  @HttpCode(HttpStatus.OK)
  @Roles('SERVICE_ADVISOR+')
  @ApiBody({ type: WoAssignDto })
  assign(
    @Param('woNumber') woNumber: string,
    @Body(new ZodValidationPipe(woAssignSchema)) body: { technicianId: string },
    @Req() req: Request,
  ) {
    return this.workOrders.assign(woNumber, body.technicianId, requestMeta(req))
  }
}
