import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertTransition } from '../work-orders/work-order-state-machine'
import type { TransitionMeta } from '../bookings/bookings.service'
import type { SubmitQcInput } from './dto/quality.dto'

const CACHE_TTL_MS = 60_000

/** WO types the strict QC gate applies to (roadmap §15; lenient for WASH). */
const QC_GATE_TYPES = ['REPAIR', 'SERVICE', 'DIAGNOSTIC', 'DETAILING', 'INSPECTION_ONLY']

function allBoxesTicked(qc: {
  repairCompleted: boolean
  partsInstalled: boolean
  noLeaks: boolean
  warningLights: boolean
  testDrive: boolean
  toolsRemoved: boolean
  vehicleCleaned: boolean
  belongingsChecked: boolean
}): boolean {
  return (
    qc.repairCompleted &&
    qc.partsInstalled &&
    qc.noLeaks &&
    qc.warningLights &&
    qc.testDrive &&
    qc.toolsRemoved &&
    qc.vehicleCleaned &&
    qc.belongingsChecked
  )
}

/**
 * Quality control (Phase 5E, roadmap §4/§15 + step 15). The mechanic works to
 * TESTING and submits the fixed checklist; SERVICE_ADVISOR+ reviews it. The
 * gate lives in WorkOrdersService.transition: READY_FOR_COLLECTION on gated
 * types requires a RECENT quality check with approved=true — a job with a
 * rejected or stale QC simply cannot reach the collection bay.
 */
@Injectable()
export class QualityService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)

  constructor(private readonly prisma: PrismaService) {}

  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  /**
   * Mechanic submits the checklist from TESTING (roadmap step 15: submit-qc).
   * The WO walks TESTING → QUALITY_CHECK with a history row; an incomplete
   * submission is allowed but flagged — review will reject it.
   */
  async submit(woNumber: string, input: SubmitQcInput, actor: { id: string; role?: string }, meta: TransitionMeta) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, status: true, assignedTechnicianId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')
    if (actor.role && ['MECHANIC', 'WASHER'].includes(actor.role) && wo.assignedTechnicianId !== actor.id) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }
    assertTransition(wo.status, 'QUALITY_CHECK')

    const qc = await this.prisma.qualityCheck.create({
      data: {
        garageId: garage.id,
        workOrderId: wo.id,
        repairCompleted: input.repairCompleted,
        partsInstalled: input.partsInstalled,
        noLeaks: input.noLeaks,
        warningLights: input.warningLights,
        testDrive: input.testDrive,
        toolsRemoved: input.toolsRemoved,
        vehicleCleaned: input.vehicleCleaned,
        belongingsChecked: input.belongingsChecked,
        notes: input.notes,
        checkedById: actor.id,
      },
    })

    await this.prisma.workOrder.update({ where: { id: wo.id }, data: { status: 'QUALITY_CHECK' } })
    await this.prisma.workOrderStatusHistory.create({
      data: {
        workOrderId: wo.id,
        oldStatus: wo.status,
        newStatus: 'QUALITY_CHECK',
        actor: 'STAFF',
        changedByUserId: actor.id,
        reason: `QC submitted for ${wo.woNumber}`,
      },
    })

    await this.audit(garage.id, actor.id, 'SUBMIT_QC', qc.id, { woNumber, complete: allBoxesTicked(qc) }, meta)
    return { ...qc, complete: allBoxesTicked(qc) }
  }

  /** Storekeeper-style queue for advisors: pending checks, newest first. */
  async listPending() {
    const garage = await this.currentGarage()
    const items = await this.prisma.qualityCheck.findMany({
      where: { garageId: garage.id, approved: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { workOrder: { select: { woNumber: true, status: true, type: true } } },
    })
    return { items, total: items.length }
  }

  async getQc(id: string) {
    const garage = await this.currentGarage()
    const qc = await this.prisma.qualityCheck.findFirst({
      where: { id, garageId: garage.id },
      include: { workOrder: { select: { woNumber: true, status: true, type: true } } },
    })
    if (!qc) throw ApiError.notFound('QC_NOT_FOUND', 'Quality check was not found.')
    return { ...qc, complete: allBoxesTicked(qc) }
  }

  /**
   * Advisor decision (roadmap step 15: approve). Approving ticks the last
   * box only if the checklist is complete; the READY gate reads this row.
   * A rejection records a NEW outcome on the row — history is never erased,
   * and the mechanic fixes and re-submits (a fresh row) from TESTING.
   */
  async decide(id: string, input: { rejectedReason?: string }, actor: { id: string }) {
    const garage = await this.currentGarage()
    const qc = await this.prisma.qualityCheck.findFirst({
      where: { id, garageId: garage.id },
      select: {
        id: true, approved: true, workOrderId: true,
        repairCompleted: true, partsInstalled: true, noLeaks: true, warningLights: true,
        testDrive: true, toolsRemoved: true, vehicleCleaned: true, belongingsChecked: true,
        workOrder: { select: { woNumber: true } },
      },
    })
    if (!qc) throw ApiError.notFound('QC_NOT_FOUND', 'Quality check was not found.')
    if (qc.approved !== null) {
      throw new ApiError('QC_ALREADY_DECIDED', `Quality check is already ${qc.approved ? 'approved' : 'rejected'}.`, 409)
    }
    const complete = allBoxesTicked(qc)
    if (!input.rejectedReason && !complete) {
      throw new ApiError(
        'QC_INCOMPLETE',
        'Cannot approve an incomplete checklist — reject it with a reason so the mechanic can fix it.',
        409,
      )
    }

    const approved = !input.rejectedReason
    const updated = await this.prisma.qualityCheck.update({
      where: { id },
      data: { approved, rejectedReason: input.rejectedReason },
    })

    await this.audit(garage.id, actor.id, approved ? 'APPROVE_QC' : 'REJECT_QC', id, {
      woNumber: qc.workOrder.woNumber,
      rejectedReason: input.rejectedReason,
    })
    return updated
  }

  /** WO detail helper: the latest check + whether the gate currently passes. */
  async gateFor(woNumber: string) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, type: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')
    const latest = await this.prisma.qualityCheck.findFirst({
      where: { workOrderId: wo.id },
      orderBy: { createdAt: 'desc' },
    })
    const gateRequired = QC_GATE_TYPES.includes(wo.type)
    const gateOpen = !!latest && latest.approved === true
    return { woNumber, type: wo.type, gateRequired, gateOpen, latest }
  }

  private async audit(
    garageId: string,
    actorId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    meta?: TransitionMeta,
  ) {
    const jsonMeta = metadata as { [key: string]: unknown } | undefined
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          actorId,
          action,
          resourceType: 'QUALITY_CHECK',
          resourceId,
          requestId: meta?.requestId,
          ipAddress: meta?.ip,
          userAgent: meta?.userAgent?.slice(0, 255),
          metadata: jsonMeta as never,
        },
      })
      .catch(() => undefined)
  }
}
