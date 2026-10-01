import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import type { Prisma, ResultStatus } from '@prisma/client'
import type { TransitionMeta } from '../bookings/bookings.service'

const CACHE_TTL_MS = 60_000

/** Severity mapping used when auto-creating a finding from a result. */
export const SEVERITY_BY_RESULT: Record<Exclude<ResultStatus, 'NOT_CHECKED'>, 'OK' | 'WATCH' | 'ATTENTION' | 'CRITICAL'> = {
  GOOD: 'OK',
  WATCH: 'WATCH',
  NEEDS_ATTENTION: 'ATTENTION',
  CRITICAL: 'CRITICAL',
}

/**
 * Inspections (Phase 5B) — the digital vehicle inspection engine.
 * Templates are garage-owned; a run snapshots the template's item IDs so
 * later template edits never corrupt historical inspections. Result writes
 * are idempotent upserts keyed by client-generated IDs (offline outbox safe,
 * roadmap §2.4).
 */
@Injectable()
export class InspectionsService {
  private garageCache = new TtlCache<{ id: string }>(CACHE_TTL_MS)
  private templateCache = new TtlCache<{ id: string; version: number }>(CACHE_TTL_MS)

  constructor(private readonly prisma: PrismaService) {}

  private async currentGarage(): Promise<{ id: string }> {
    const cached = this.garageCache.get('garage:current')
    if (cached) return cached
    const g = await this.prisma.garage.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
    if (!g) throw ApiError.notFound('NOT_FOUND', 'Garage profile not found.')
    this.garageCache.set('garage:current', g)
    return g
  }

  // ------------------------------------------------------------------
  // Runs
  // ------------------------------------------------------------------

  /** Starts (or returns the existing) inspection run for a work order. */
  async startRun(woNumber: string, actor: { id: string; role: string }) {
    const garage = await this.currentGarage()

    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, status: true, assignedTechnicianId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    // Mechanics/washers only work their own orders (object-level authz §28).
    if (['MECHANIC', 'WASHER'].includes(actor.role) && wo.assignedTechnicianId !== actor.id) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }

    const template = await this.prisma.inspectionTemplate.findFirst({
      where: { garageId: garage.id, isActive: true },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    })
    if (!template) throw ApiError.notFound('NOT_FOUND', 'No inspection template configured for this garage.')

    // One run per work order (unique FK) — resuming returns the same run.
    const existing = await this.prisma.inspectionRun.findUnique({
      where: { workOrderId: wo.id },
    })
    if (existing) return existing

    const run = await this.prisma.inspectionRun.create({
      data: {
        garageId: garage.id,
        workOrderId: wo.id,
        templateId: template.id,
        templateVersion: template.version,
        conductedById: actor.id,
      },
    })

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'START_INSPECTION',
          resourceType: 'INSPECTION_RUN',
          resourceId: run.id,
          metadata: { woNumber, templateId: template.id, templateVersion: template.version },
        },
      })
      .catch(() => undefined)

    return run
  }

  /**
   * Fill-in view: the template items for the run + any already-recorded
   * results. This is what the mechanic app renders — no prose, just taps.
   */
  async getRunForm(runId: string, actor: { id: string; role: string }) {
    const garage = await this.currentGarage()
    const run = await this.prisma.inspectionRun.findFirst({
      where: { id: runId, garageId: garage.id },
      include: {
        workOrder: { select: { woNumber: true, status: true, assignedTechnicianId: true } },
        results: { select: { id: true, itemId: true, status: true, measurement: true, unit: true, note: true, photoMediaId: true, updatedAt: true } },
      },
    })
    if (!run) throw ApiError.notFound('INSPECTION_NOT_FOUND', 'Inspection run was not found.')

    if (['MECHANIC', 'WASHER'].includes(actor.role) && run.workOrder.assignedTechnicianId !== actor.id) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }

    const items = await this.prisma.inspectionItem.findMany({
      where: { templateId: run.templateId },
      orderBy: { displayOrder: 'asc' },
      select: {
        id: true, section: true, label: true, measurementUnit: true, allowPhoto: true,
        watchSeverity: true, needsAttentionSeverity: true, criticalSeverity: true,
      },
    })

    const bySection = new Map<string, typeof items>()
    for (const item of items) {
      const list = bySection.get(item.section) ?? []
      list.push(item)
      bySection.set(item.section, list)
    }

    return {
      run: {
        id: run.id,
        woNumber: run.workOrder.woNumber,
        woStatus: run.workOrder.status,
        completedAt: run.completedAt,
        templateVersion: run.templateVersion,
        conductedById: run.conductedById,
      },
      sections: [...bySection.entries()].map(([section, sectionItems]) => ({
        section,
        items: sectionItems,
      })),
      results: run.results,
    }
  }

  /**
   * THE offline-safe write: idempotent upsert keyed by the client-generated
   * result id. Replaying the same payload is a no-op; re-recording an item
   * (same run+item, new client id) overwrites via the unique constraint.
   */
  async upsertResult(
    runId: string,
    resultId: string,
    input: {
      itemId: string
      status: ResultStatus
      measurement?: number | null
      unit?: string | null
      note?: string | null
      photoMediaId?: string | null
    },
    actor: { id: string; role: string },
  ) {
    const garage = await this.currentGarage()
    const run = await this.prisma.inspectionRun.findFirst({
      where: { id: runId, garageId: garage.id },
      select: {
        id: true, completedAt: true, templateId: true,
        workOrder: { select: { woNumber: true, assignedTechnicianId: true } },
      },
    })
    if (!run) throw ApiError.notFound('INSPECTION_NOT_FOUND', 'Inspection run was not found.')
    if (run.completedAt) throw new ApiError('RUN_ALREADY_COMPLETED', 'This inspection was already submitted.', 409)

    if (['MECHANIC', 'WASHER'].includes(actor.role) && run.workOrder.assignedTechnicianId !== actor.id) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }

    // The item must belong to the run's template snapshot (server-side
    // validation — never trust client item IDs).
    const item = await this.prisma.inspectionItem.findFirst({
      where: { id: input.itemId, templateId: run.templateId },
      select: { id: true, measurementUnit: true },
    })
    if (!item) throw ApiError.notFound('ITEM_NOT_IN_TEMPLATE', 'Checklist item does not belong to this inspection.')

    if (input.photoMediaId) {
      const media = await this.prisma.mediaFile.findFirst({
        where: { id: input.photoMediaId, garageId: garage.id, status: 'READY' },
        select: { id: true },
      })
      if (!media) throw ApiError.validation('Attached photo was not found or upload is not complete.')
    }

    const select = { id: true, itemId: true, status: true, measurement: true, unit: true, note: true, photoMediaId: true, updatedAt: true } as const
    const data = {
      status: input.status,
      measurement: input.measurement ?? null,
      unit: input.unit ?? item.measurementUnit,
      note: input.note?.slice(0, 500) ?? null,
      photoMediaId: input.photoMediaId ?? undefined,
      recordedById: actor.id,
    }

    try {
      // Primary path: client-generated id (offline outbox replay = no-op upsert).
      return await this.prisma.inspectionResult.upsert({
        where: { id: resultId },
        update: data,
        create: { id: resultId, runId: run.id, itemId: input.itemId, ...data, photoMediaId: input.photoMediaId ?? null },
        select,
      })
    } catch (e) {
      // Offline client re-recorded an item under a NEW client id: the
      // (runId,itemId) unique constraint fires — last write wins instead of 500.
      if ((e as { code?: string }).code === 'P2002') {
        return this.prisma.inspectionResult.update({
          where: { runId_itemId: { runId: run.id, itemId: input.itemId } },
          data,
          select,
        })
      }
      throw e
    }
  }

  /**
   * Submits the run (mechanic done → advisor review). Requires every item
   * to have a non-NOT_CHECKED result or be explicitly recorded.
   */
  async submitRun(runId: string, actor: { id: string; role: string }) {
    const garage = await this.currentGarage()
    const run = await this.prisma.inspectionRun.findFirst({
      where: { id: runId, garageId: garage.id },
      select: {
        id: true, completedAt: true, templateId: true,
        workOrder: { select: { woNumber: true, status: true, assignedTechnicianId: true } },
        results: { select: { itemId: true, status: true } },
      },
    })
    if (!run) throw ApiError.notFound('INSPECTION_NOT_FOUND', 'Inspection run was not found.')
    if (run.completedAt) throw new ApiError('RUN_ALREADY_COMPLETED', 'This inspection was already submitted.', 409)
    if (['MECHANIC', 'WASHER'].includes(actor.role) && run.workOrder.assignedTechnicianId !== actor.id) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }

    const templateItems = await this.prisma.inspectionItem.findMany({
      where: { templateId: run.templateId },
      select: { id: true, label: true },
    })
    const resultMap = new Map(run.results.map((r) => [r.itemId, r.status]))
    const missing = templateItems.filter((i) => !resultMap.has(i.id)).map((i) => i.label)
    if (missing.length > 0) {
      throw ApiError.validation(
        `Inspection incomplete — ${missing.length} item(s) not recorded (e.g. ${missing.slice(0, 3).join(', ')}).`,
        { missing: missing.map((label) => ({ label })) },
      )
    }

    const updated = await this.prisma.inspectionRun.update({
      where: { id: run.id },
      data: { completedAt: new Date() },
      select: { id: true, completedAt: true },
    })

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'SUBMIT_INSPECTION',
          resourceType: 'INSPECTION_RUN',
          resourceId: run.id,
          metadata: { woNumber: run.workOrder.woNumber, resultCount: run.results.length },
        },
      })
      .catch(() => undefined)

    return updated
  }

  // ------------------------------------------------------------------
  // Findings — promotion, review, customer decision
  // ------------------------------------------------------------------

  /** Promotes a result (or creates standalone) into a customer-facing finding. */
  async promoteFinding(
    runId: string,
    input: {
      resultId?: string
      title: string
      severity?: 'OK' | 'WATCH' | 'ATTENTION' | 'CRITICAL'
      recommendation?: string
    },
    actor: { id: string; role: string },
  ) {
    const garage = await this.currentGarage()
    const run = await this.prisma.inspectionRun.findFirst({
      where: { id: runId, garageId: garage.id },
      select: {
        id: true,
        workOrder: { select: { id: true, woNumber: true, assignedTechnicianId: true } },
      },
    })
    if (!run) throw ApiError.notFound('INSPECTION_NOT_FOUND', 'Inspection run was not found.')

    // Any staff on the job may propose findings; advisors review them.
    let severity: 'OK' | 'WATCH' | 'ATTENTION' | 'CRITICAL' | undefined = input.severity
    let result: { id: string; status: ResultStatus } | null = null

    if (input.resultId) {
      result = await this.prisma.inspectionResult.findFirst({
        where: { id: input.resultId, runId: run.id },
        select: { id: true, status: true },
      })
      if (!result) throw ApiError.notFound('RESULT_NOT_FOUND', 'Inspection result was not found.')
    }

    const derived =
      result && result.status !== 'NOT_CHECKED'
        ? SEVERITY_BY_RESULT[result.status]
        : undefined

    const finding = await this.prisma.inspectionFinding.create({
      data: {
        garageId: garage.id,
        workOrderId: run.workOrder.id,
        runId: run.id,
        resultId: result?.id,
        title: input.title.slice(0, 140),
        severity: severity ?? derived ?? 'ATTENTION',
        status: 'PROPOSED',
        customerVisible: false,
        recommendation: input.recommendation?.slice(0, 300),
        createdById: actor.id,
      },
    })

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'CREATE_FINDING',
          resourceType: 'INSPECTION_FINDING',
          resourceId: finding.id,
          metadata: { woNumber: run.workOrder.woNumber, fromResult: result?.id ?? null },
        },
      })
      .catch(() => undefined)

    return finding
  }

  /** Advisor review: customer-facing copy + visibility. */
  async reviewFinding(
    findingId: string,
    input: { customerTitle?: string; customerExplanation?: string; customerVisible?: boolean },
    actor: { id: string },
  ) {
    const garage = await this.currentGarage()
    const finding = await this.prisma.inspectionFinding.findFirst({
      where: { id: findingId, garageId: garage.id },
      select: { id: true, status: true },
    })
    if (!finding) throw ApiError.notFound('NOT_FOUND', 'Finding was not found.')

    return this.prisma.inspectionFinding.update({
      where: { id: finding.id },
      data: {
        customerTitle: input.customerTitle?.slice(0, 140),
        customerExplanation: input.customerExplanation?.slice(0, 1000),
        customerVisible: input.customerVisible ?? false,
        decidedById: actor.id,
      },
      select: { id: true, customerTitle: true, customerExplanation: true, customerVisible: true },
    })
  }

  /** Sends findings to the customer (advisor) → status SENT. */
  async sendFindings(woNumber: string, actor: { id: string }) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    const { count } = await this.prisma.inspectionFinding.updateMany({
      where: { workOrderId: wo.id, status: 'PROPOSED', customerVisible: true },
      data: { status: 'SENT', decidedById: actor.id },
    })
    if (count === 0) {
      throw ApiError.validation('No reviewed, customer-visible findings to send.')
    }

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: 'SEND_FINDINGS',
          resourceType: 'WORK_ORDER',
          resourceId: wo.id,
          metadata: { woNumber, count },
        },
      })
      .catch(() => undefined)

    return { sent: count }
  }

  /** Customer decision on a single finding (approve / decline / defer). */
  async decideFinding(
    findingId: string,
    decision: 'APPROVE' | 'DECLINE' | 'DEFER',
    input: { reason?: string; note?: string; followUpAt?: string },
    actor: { id: string; role: string },
  ) {
    const garage = await this.currentGarage()
    const finding = await this.prisma.inspectionFinding.findFirst({
      where: { id: findingId, garageId: garage.id },
      select: {
        id: true, status: true, customerVisible: true,
        workOrder: { select: { customerId: true, woNumber: true } },
      },
    })
    if (!finding) throw ApiError.notFound('NOT_FOUND', 'Finding was not found.')

    // CUSTOMERs may decide their own job's sent findings; staff may too.
    // Ownership is checked FIRST so non-owners can't probe finding states.
    if (actor.role === 'CUSTOMER') {
      if (finding.workOrder.customerId !== actor.id) {
        // 404 — never reveal other customers' findings (§28).
        throw ApiError.notFound('NOT_FOUND', 'Finding was not found.')
      }
      if (!finding.customerVisible || finding.status !== 'SENT') {
        throw ApiError.forbidden('This finding is not awaiting your decision.')
      }
    }

    const statusMap = {
      APPROVE: 'APPROVED',
      DECLINE: 'DECLINED',
      DEFER: 'DEFERRED',
    } as const

    if (finding.status !== 'SENT') {
      throw new ApiError('INVALID_STATUS_TRANSITION', `Finding is not awaiting a decision (current: ${finding.status}).`, 409)
    }

    const updated = await this.prisma.inspectionFinding.update({
      where: { id: finding.id },
      data: {
        status: statusMap[decision],
        declineReason: decision === 'DECLINE' ? (input.reason ?? 'OTHER').slice(0, 40) : null,
        followUpAt: decision === 'DEFER' && input.followUpAt ? new Date(input.followUpAt) : null,
        decidedById: actor.id,
      },
      select: { id: true, status: true, followUpAt: true, declineReason: true },
    })

    await this.prisma.auditLog
      .create({
        data: {
          garageId: garage.id,
          actorId: actor.id,
          action: `FINDING_${decision}`,
          resourceType: 'INSPECTION_FINDING',
          resourceId: finding.id,
          metadata: { woNumber: finding.workOrder.woNumber, reason: input.reason ?? null, note: input.note ?? null },
        },
      })
      .catch(() => undefined)

    return updated
  }

  /** Findings for a work order; customers get only their visible ones. */
  async listFindings(woNumber: string, actor: { id: string; role: string }) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, customerId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')

    const isCustomer = actor.role === 'CUSTOMER'
    if (isCustomer && wo.customerId !== actor.id) {
      throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')
    }

    const findings = await this.prisma.inspectionFinding.findMany({
      where: {
        workOrderId: wo.id,
        ...(isCustomer ? { customerVisible: true } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: isCustomer
        ? {
            id: true, customerTitle: true, customerExplanation: true, severity: true,
            status: true, recommendation: true, followUpAt: true, createdAt: true,
          }
        : {
            id: true, title: true, customerTitle: true, severity: true, status: true,
            customerVisible: true, recommendation: true, declineReason: true,
            followUpAt: true, resultId: true, createdAt: true,
          },
    })
    return { findings }
  }
}
