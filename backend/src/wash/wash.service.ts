import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertWashTransition, WORK_ORDER_STATUS_FOR_STEP, WASH_TRANSITIONS } from './wash-state-machine'
import type { TransitionMeta } from '../bookings/bookings.service'
import type { WashStep } from '@prisma/client'

const CACHE_TTL_MS = 60_000

/**
 * Car wash (Phase 6, docs/platform-roadmap-v2.md §2.2). A wash is a work
 * order with type=WASH plus this ONE wash_jobs row; the washer's app presses
 * [START] [WASH COMPLETE] [VACUUM COMPLETE] [DETAILING COMPLETE] [QC]
 * [READY] — each press is POST /wash-jobs/:woNumber/step, which advances
 * the step machine, appends the jsonb audit trail and walks the underlying
 * work order (CHECKED_IN → IN_PROGRESS → QUALITY_CHECK → READY_FOR_
 * COLLECTION) so washes and repairs share one vehicle timeline.
 */
@Injectable()
export class WashService {
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

  /** The queue: open wash jobs with their live step + vehicle + washer. */
  async board() {
    const garage = await this.currentGarage()
    const rows = await this.prisma.washJob.findMany({
      where: { garageId: garage.id, completedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        workOrder: {
          select: {
            woNumber: true, status: true, priority: true, vehicleText: true, bayLabel: true, createdAt: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
        service: { select: { name: true, basePrice: true } },
        washer: { select: { firstName: true, lastName: true } },
      },
    })
    return {
      items: rows.map((w) => ({
        id: w.id,
        woNumber: w.workOrder.woNumber,
        package: w.service.name,
        packagePriceCents: w.service.basePrice,
        currentStep: w.currentStep,
        washer: w.washer ? `${w.washer.firstName} ${w.washer.lastName}` : null,
        customer: w.workOrder.customer,
        vehicleText: w.workOrder.vehicleText,
        priority: w.workOrder.priority,
        workOrderStatus: w.workOrder.status,
        waitingSince: w.workOrder.createdAt,
      })),
    }
  }

  /** The washer's personal queue — my-today, wash edition. */
  async myToday(washerId: string) {
    const garage = await this.currentGarage()
    const rows = await this.prisma.washJob.findMany({
      where: { garageId: garage.id, washerId, completedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        workOrder: {
          select: {
            woNumber: true, status: true, priority: true, vehicleText: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
        service: { select: { name: true } },
      },
    })
    return { items: rows }
  }

  /** Full detail: job + package + WO snapshot + the step history. */
  async getJob(woNumber: string) {
    const garage = await this.currentGarage()
    const job = await this.prisma.washJob.findFirst({
      where: { garageId: garage.id, workOrder: { woNumber } },
      include: {
        service: { select: { id: true, name: true, basePrice: true } },
        washer: { select: { id: true, firstName: true, lastName: true } },
        workOrder: {
          select: {
            woNumber: true, status: true, type: true, vehicleText: true, complaint: true,
            customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
    })
    if (!job) throw ApiError.notFound('WASH_JOB_NOT_FOUND', 'Wash job was not found.')
    return {
      ...job,
      allowedNextSteps: WASH_TRANSITIONS[job.currentStep],
      terminal: job.currentStep === 'READY',
    }
  }

  /**
   * Assign a washer to a queued wash job (SERVICE_ADVISOR+; washer allowed
   * to self-claim). Cross-garage washers 404 without existence leaks.
   */
  async assign(woNumber: string, washerId: string, meta: TransitionMeta) {
    const garage = await this.currentGarage()
    const washer = await this.prisma.user.findFirst({
      where: { id: washerId, garageId: garage.id, role: 'WASHER', deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!washer) throw ApiError.notFound('NOT_FOUND', 'Washer was not found in this garage.')

    const job = await this.prisma.washJob.findFirst({
      where: { garageId: garage.id, workOrder: { woNumber } },
      select: { id: true, workOrderId: true, washerId: true, workOrder: { select: { status: true } } },
    })
    if (!job) throw ApiError.notFound('WASH_JOB_NOT_FOUND', 'Wash job was not found.')

    await this.prisma.$transaction(async (tx) => {
      await tx.washJob.update({ where: { id: job.id }, data: { washerId } })
      await tx.workOrder.update({ where: { id: job.workOrderId }, data: { assignedTechnicianId: washerId } })
      // Same-status history row records the assignment (mirrors workshop);
      // the washer identity lives on the wash job + this audit row.
      await tx.workOrderStatusHistory.create({
        data: {
          workOrderId: job.workOrderId,
          oldStatus: job.workOrder.status,
          newStatus: job.workOrder.status,
          actor: meta.actorId ? 'STAFF' : 'SYSTEM',
          changedByUserId: meta.actorId,
          reason: `Washer assigned (${washerId})`,
        },
      })
    })

    await this.audit(garage.id, job.workOrderId, woNumber, 'WASHER_ASSIGNED', meta, { washerId })
    return { woNumber, washerId }
  }

  /**
   * One press of the washer's five-button UI. `eventId` (client UUID, header
   * or body) makes offline replays a no-op: the same event id twice returns
   * the same job unchanged. The step machine, jsonb history, WO walk and
   * audit row all commit in one transaction.
   */
  async step(woNumber: string, input: { step: WashStep; reason?: string; notes?: string }, eventId: string | undefined, meta: TransitionMeta) {
    const garage = await this.currentGarage()
    const actorId = meta.actorId
    const actorRole = meta.actorRole

    // last_step_event_id is a UUID column — reject junk event ids with a
    // clean 400 instead of letting the driver throw mid-transaction.
    if (eventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      throw ApiError.validation('X-Event-Id must be a client-generated UUID.')
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const job = await tx.washJob.findFirst({
        where: { garageId: garage.id, workOrder: { woNumber } },
        select: {
          id: true, workOrderId: true, serviceId: true, washerId: true,
          currentStep: true, lastStepEventId: true, stepHistory: true,
          workOrder: { select: { woNumber: true, status: true, type: true, assignedTechnicianId: true } },
        },
      })
      if (!job) throw ApiError.notFound('WASH_JOB_NOT_FOUND', 'Wash job was not found.')
      if (job.workOrder.type !== 'WASH') {
        throw new ApiError('NOT_A_WASH_JOB', 'This work order is not a wash.', 409)
      }

      // Offline replay: the same client event id → return state unchanged.
      if (eventId && job.lastStepEventId === eventId) {
        return { replayed: true, job }
      }

      // WASHER may only press their own jobs; SA+ may press anything.
      if (actorRole && ['WASHER', 'MECHANIC'].includes(actorRole) && job.workOrder.assignedTechnicianId !== actorId) {
        throw ApiError.forbidden('This wash job is not assigned to you.')
      }
      if (job.currentStep === 'READY') {
        throw new ApiError('WASH_ALREADY_READY', 'This wash is already ready for collection.', 409)
      }
      if (input.step === 'QUALITY_CHECK' && job.currentStep !== 'WASHING' && job.currentStep !== 'VACUUMING' && job.currentStep !== 'DETAILING') {
        throw new ApiError('INVALID_WASH_STEP_TRANSITION', `Cannot QC from ${job.currentStep}.`, 409)
      }
      if (!eventId) {
        throw ApiError.validation('X-Event-Id header is required — a client-generated UUID per step press.')
      }
      assertWashTransition(job.currentStep, input.step)

      const history = Array.isArray(job.stepHistory) ? [...(job.stepHistory as object[])] : []
      history.push({
        from: job.currentStep,
        to: input.step,
        at: new Date().toISOString(),
        by: actorId ?? null,
        eventId,
        reason: input.reason ?? null,
      })

      // Walk the WO alongside the step (§2.2: one vehicle, one history).
      const woTarget = WORK_ORDER_STATUS_FOR_STEP[input.step]
      if (job.workOrder.status !== woTarget) {
        await tx.workOrder.update({ where: { id: job.workOrderId }, data: { status: woTarget } })
        await tx.workOrderStatusHistory.create({
          data: {
            workOrderId: job.workOrderId,
            oldStatus: job.workOrder.status,
            newStatus: woTarget,
            actor: actorId ? 'STAFF' : 'SYSTEM',
            changedByUserId: actorId,
            reason: `Wash step ${job.currentStep} → ${input.step}`,
          },
        })
      }

      const updated = await tx.washJob.update({
        where: { id: job.id },
        data: {
          currentStep: input.step,
          stepHistory: history,
          lastStepEventId: eventId,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.step === 'READY' ? { completedAt: new Date(), washerId: job.washerId ?? actorId } : {}),
        },
      })
      return { replayed: false, job: updated, prevStep: job.currentStep, woStatus: job.workOrder.status, woTarget }
    })

    if (!result.replayed) {
      await this.audit(garage.id, result.job.workOrderId, woNumber, `STEP_${input.step}`, meta, {
        from: result.prevStep,
        to: input.step,
        eventId: eventId ?? null,
      })
    }
    return {
      woNumber,
      currentStep: result.job.currentStep,
      allowedNextSteps: WASH_TRANSITIONS[result.job.currentStep],
      terminal: result.job.currentStep === 'READY',
      replayed: result.replayed,
    }
  }

  /** Best-effort audit — never fails the operation (§37). */
  private async audit(
    garageId: string,
    workOrderId: string,
    woNumber: string,
    action: string,
    meta: TransitionMeta,
    extra: Record<string, unknown>,
  ) {
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          actorId: meta.actorId,
          action: `WASH_${action}`,
          resourceType: 'WASH_JOB',
          resourceId: workOrderId,
          requestId: meta.requestId,
          ipAddress: meta.ip?.slice(0, 60),
          userAgent: meta.userAgent?.slice(0, 255),
          metadata: { woNumber, ...extra } as never,
        },
      })
      .catch(() => undefined)
  }
}
