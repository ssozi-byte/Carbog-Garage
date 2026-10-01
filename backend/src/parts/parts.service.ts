import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ApiError } from '../common/errors/error-codes'
import { TtlCache } from '../common/cache/ttl-cache'
import { assertTransition } from '../work-orders/work-order-state-machine'
import type { TransitionMeta } from '../bookings/bookings.service'
import type {
  AdjustStockInput,
  CreatePartInput,
  CreatePartRequestInput,
  ListPartsQuery,
  ListRequestsQuery,
  UpdatePartInput,
} from './dto/part.dto'
import type { Prisma, WorkOrderStatus } from '@prisma/client'

const CACHE_TTL_MS = 60_000

/**
 * Parts & inventory (Phase 5D, roadmap v2 §4 "Parts (§13)").
 *
 * Two invariants carry the whole design:
 *  1. quantityOnHand is ONLY mutated inside issuePart/adjustStock, which
 *     append the matching inventory_transactions row in the SAME DB
 *     transaction — the ledger is the audit trail, the number is derived.
 *  2. Issuing a part against a parts_request is the only path that touches
 *     both stock and the job card, so concurrency-safe updates + a machine
 *     walk (IN_PROGRESS ↔ WAITING_PARTS) live in exactly one place.
 */
@Injectable()
export class PartsService {
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

  // ------------------------------------------------------------------
  // Catalog (INVENTORY_MANAGER+ writes, MECHANIC+ reads)
  // ------------------------------------------------------------------

  /** Creates a catalog part; a nonzero initial stock writes a PURCHASE row. */
  async createPart(input: CreatePartInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    const existing = await this.prisma.part.findFirst({
      where: { garageId: garage.id, sku: input.sku, deletedAt: null },
      select: { id: true, sku: true },
    })
    if (existing) {
      throw new ApiError('PART_SKU_TAKEN', `SKU ${input.sku} already exists in this garage.`, 409)
    }

    const part = await this.prisma.$transaction(async (tx) => {
      const row = await tx.part.create({
        data: {
          garageId: garage.id,
          sku: input.sku,
          name: input.name,
          manufacturer: input.manufacturer,
          partNumber: input.partNumber,
          description: input.description,
          unitCostCents: input.unitCostCents,
          sellingPriceCents: input.sellingPriceCents,
          quantityOnHand: input.quantityOnHand,
          reorderLevel: input.reorderLevel,
        },
      })
      if (input.quantityOnHand > 0) {
        await tx.inventoryTransaction.create({
          data: {
            garageId: garage.id,
            partId: row.id,
            transactionType: 'PURCHASE',
            quantityDelta: input.quantityOnHand,
            quantityAfter: input.quantityOnHand,
            unitCostCents: input.unitCostCents || null,
            notes: 'Initial stock on part creation',
          },
        })
      }
      return row
    })

    await this.audit(garage.id, actor.id, 'CREATE_PART', part.id, { sku: input.sku })
    return part
  }

  /** Metadata edit — never touches stock (adjustStock does that, with a ledger row). */
  async updatePart(partId: string, input: UpdatePartInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    await this.findPart(garage.id, partId)
    const part = await this.prisma.part.update({
      where: { id: partId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
        ...(input.partNumber !== undefined ? { partNumber: input.partNumber } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.unitCostCents !== undefined ? { unitCostCents: input.unitCostCents } : {}),
        ...(input.sellingPriceCents !== undefined ? { sellingPriceCents: input.sellingPriceCents } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
      },
    })
    await this.audit(garage.id, actor.id, 'UPDATE_PART', part.id, { fields: Object.keys(input) })
    return part
  }

  async listParts(query: ListPartsQuery) {
    const garage = await this.currentGarage()
    const where: Prisma.PartWhereInput = {
      garageId: garage.id,
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              { partNumber: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    // lowStock compares a column to a column (qty <= reorder), which Prisma's
    // typed where cannot express — catalogs are small, so filter in JS.
    let parts = await this.prisma.part.findMany({ where, orderBy: { name: 'asc' } })
    if (query.lowStock === 'true') {
      parts = parts.filter((p) => p.quantityOnHand <= p.reorderLevel)
    }
    const total = parts.length
    const start = (query.page - 1) * query.limit
    return { items: parts.slice(start, start + query.limit), total, page: query.page, limit: query.limit }
  }

  /** One part + its full stock ledger (INVENTORY_MANAGER+, §6 matrix). */
  async getPart(partId: string) {
    const garage = await this.currentGarage()
    const part = await this.findPart(garage.id, partId)
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: { partId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return { ...part, transactions }
  }

  /** Append-only stock ledger, optionally scoped to one part. */
  async listTransactions(partId?: string) {
    const garage = await this.currentGarage()
    if (partId) {
      await this.findPart(garage.id, partId)
    }
    const items = await this.prisma.inventoryTransaction.findMany({
      where: { garageId: garage.id, ...(partId ? { partId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { part: { select: { sku: true, name: true } } },
    })
    return { items, total: items.length }
  }

  /**
   * Manual stock movement (goods-in, damage, shrinkage). One DB transaction
   * = parts update + append-only ledger row; the conditional update makes
   * the non-negative-stock rule race-free even under concurrent issues.
   */
  async adjustStock(partId: string, input: AdjustStockInput, actor: { id: string }) {
    const garage = await this.currentGarage()
    await this.findPart(garage.id, partId)
    const delta = input.quantityDelta

    const result = await this.prisma.$transaction(async (tx) => {
      // updateMany for both directions so the guard check is uniform; positive
      // deltas are unguarded, negative ones require quantityOnHand >= |delta|.
      const updated = await tx.part.updateMany({
        where: delta > 0 ? { id: partId } : { id: partId, quantityOnHand: { gte: -delta } },
        data:
          delta > 0
            ? {
                quantityOnHand: { increment: delta },
                ...(input.unitCostCents !== undefined ? { unitCostCents: input.unitCostCents } : {}),
              }
            : { quantityOnHand: { decrement: -delta } },
      })
      if (delta < 0 && updated.count === 0) {
        const current = await tx.part.findUniqueOrThrow({
          where: { id: partId },
          select: { quantityOnHand: true },
        })
        throw new ApiError(
          'INSUFFICIENT_STOCK',
          `Only ${current.quantityOnHand} on hand; cannot adjust by ${delta}.`,
          409,
        )
      }
      const final = await tx.part.findUniqueOrThrow({
        where: { id: partId },
        select: { quantityOnHand: true },
      })
      await tx.inventoryTransaction.create({
        data: {
          garageId: garage.id,
          partId,
          transactionType: input.type,
          quantityDelta: delta,
          quantityAfter: final.quantityOnHand,
          unitCostCents: input.unitCostCents ?? null,
          supplierRef: input.supplierRef,
          notes: input.notes,
          performedById: actor.id,
        },
      })
      return final.quantityOnHand
    })

    await this.audit(garage.id, actor.id, 'ADJUST_STOCK', partId, {
      type: input.type,
      delta,
      after: result,
    })
    return { partId, quantityOnHand: result }
  }

  // ------------------------------------------------------------------
  // Parts requests (mechanic ask → storekeeper decision)
  // ------------------------------------------------------------------

  /**
   * Mechanic requests a part for a job card. The WO walks to WAITING_PARTS
   * through legal machine moves only (with history rows per step); already
   * IN_PROGRESS/WAITING_PARTS jobs stay put. Mechanics can only request
   * against their own assigned orders (object-level authz).
   */
  async createRequest(
    woNumber: string,
    input: CreatePartRequestInput,
    actor: { id: string; role?: string },
    meta: TransitionMeta,
  ) {
    const garage = await this.currentGarage()
    const wo = await this.prisma.workOrder.findFirst({
      where: { woNumber, garageId: garage.id },
      select: { id: true, woNumber: true, status: true, assignedTechnicianId: true },
    })
    if (!wo) throw ApiError.notFound('WORK_ORDER_NOT_FOUND', 'Work order was not found.')
    if (
      actor.role && ['MECHANIC', 'WASHER'].includes(actor.role) &&
      wo.assignedTechnicianId !== actor.id
    ) {
      throw ApiError.forbidden('This job is not assigned to you.')
    }

    const part = await this.findPart(garage.id, input.partId)
    if (!part.isActive) {
      throw new ApiError('PART_NOT_FOUND', `Part ${part.sku} is inactive.`, 409)
    }

    const request = await this.prisma.partRequest.create({
      data: {
        garageId: garage.id,
        workOrderId: wo.id,
        partId: part.id,
        quantity: input.quantity,
        note: input.note,
        requestedById: actor.id,
      },
      include: { part: { select: { sku: true, name: true, quantityOnHand: true } } },
    })

    // Roadmap §5 step 12: → WAITING_PARTS until issued. A working job is
    // THE requesting case (mechanic mid-repair, shelf runs dry), so
    // IN_PROGRESS → WAITING_PARTS is the primary edge; CHECKED_IN/INSPECTION
    // jobs first walk through IN_PROGRESS. Jobs already WAITING_PARTS or
    // later (TESTING…) stay put.
    let woStatus = wo.status
    if (['CHECKED_IN', 'INSPECTION', 'IN_PROGRESS'].includes(woStatus)) {
      const steps: WorkOrderStatus[] = woStatus === 'IN_PROGRESS' ? ['WAITING_PARTS'] : ['IN_PROGRESS', 'WAITING_PARTS']
      for (const step of steps) {
        assertTransition(woStatus, step)
        await this.prisma.workOrder.update({ where: { id: wo.id }, data: { status: step } })
        await this.prisma.workOrderStatusHistory.create({
          data: {
            workOrderId: wo.id,
            oldStatus: woStatus,
            newStatus: step,
            actor: 'STAFF',
            changedByUserId: actor.id,
            reason: `Parts requested for ${wo.woNumber} (${part.sku} ×${input.quantity})`,
          },
        })
        woStatus = step
      }
    }

    await this.audit(garage.id, actor.id, 'CREATE_PART_REQUEST', request.id, {
      woNumber,
      partId: part.id,
      quantity: input.quantity,
    })
    return { ...request, woStatus }
  }

  /** Open requests for the storekeeper queue (or one job's full list). */
  async listRequests(query: ListRequestsQuery, workOrderNumber?: string) {
    const garage = await this.currentGarage()
    const where: Prisma.PartRequestWhereInput = {
      garageId: garage.id,
      ...(query.status ? { status: query.status } : {}),
      ...(workOrderNumber ? { workOrder: { woNumber: workOrderNumber } } : {}),
    }
    const items = await this.prisma.partRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        part: { select: { sku: true, name: true, quantityOnHand: true } },
        workOrder: { select: { woNumber: true, status: true } },
        requester: { select: { firstName: true, lastName: true } },
      },
    })
    return { items, total: items.length }
  }

  async getRequest(id: string) {
    const garage = await this.currentGarage()
    const request = await this.prisma.partRequest.findFirst({
      where: { id, garageId: garage.id },
      include: {
        part: { select: { id: true, sku: true, name: true, quantityOnHand: true, sellingPriceCents: true } },
        workOrder: { select: { woNumber: true, status: true } },
        requester: { select: { firstName: true, lastName: true } },
        decider: { select: { firstName: true, lastName: true } },
      },
    })
    if (!request) throw ApiError.notFound('PART_REQUEST_NOT_FOUND', 'Part request was not found.')
    return request
  }

  /**
   * THE 5D money step: stock −N, ledger row, request → ISSUED — one DB
   * transaction, decidedById stamped. The conditional update makes the
   * non-negative rule race-free against concurrent issues of the same part.
   * After commit the job resumes: WAITING_PARTS → IN_PROGRESS (roadmap:
   * "→ WAITING_PARTS until issued"), with a history row for the resume.
   */
  async issueRequest(id: string, actor: { id: string }) {
    const garage = await this.currentGarage()
    const request = await this.prisma.partRequest.findFirst({
      where: { id, garageId: garage.id },
      select: { id: true, status: true, quantity: true, partId: true, workOrderId: true },
    })
    if (!request) throw ApiError.notFound('PART_REQUEST_NOT_FOUND', 'Part request was not found.')
    if (request.status !== 'REQUESTED') {
      throw new ApiError(
        'INVALID_PART_REQUEST_STATE',
        `Request is ${request.status}; only REQUESTED parts can be issued.`,
        409,
      )
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      // quantityOnHand >= N is enforced HERE, not trusted from the earlier read.
      const updated = await tx.part.updateMany({
        where: { id: request.partId, quantityOnHand: { gte: request.quantity } },
        data: { quantityOnHand: { decrement: request.quantity } },
      })
      if (updated.count === 0) {
        const part = await tx.part.findUniqueOrThrow({
          where: { id: request.partId },
          select: { quantityOnHand: true, sku: true },
        })
        throw new ApiError(
          'INSUFFICIENT_STOCK',
          `Only ${part.quantityOnHand} × ${part.sku} on hand; cannot issue ${request.quantity}.`,
          409,
        )
      }
      const part = await tx.part.findUniqueOrThrow({
        where: { id: request.partId },
        select: { quantityOnHand: true, sellingPriceCents: true },
      })
      await tx.inventoryTransaction.create({
        data: {
          garageId: garage.id,
          partId: request.partId,
          transactionType: 'REPAIR_USAGE',
          quantityDelta: -request.quantity,
          quantityAfter: part.quantityOnHand,
          reference: `parts_request:${request.id}`,
          performedById: actor.id,
        },
      })
      return tx.partRequest.update({
        where: { id: request.id },
        data: {
          status: 'ISSUED',
          decidedById: actor.id,
          decidedAt: new Date(),
          unitPriceAtIssueCents: part.sellingPriceCents,
        },
        include: { part: { select: { sku: true, name: true } } },
      })
    })

    // Resume the unblocked job (post-commit walk, legal edge + history row).
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: request.workOrderId },
      select: { status: true },
    })
    if (wo?.status === 'WAITING_PARTS') {
      assertTransition(wo.status, 'IN_PROGRESS')
      await this.prisma.workOrder.update({
        where: { id: request.workOrderId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      })
      await this.prisma.workOrderStatusHistory.create({
        data: {
          workOrderId: request.workOrderId,
          oldStatus: 'WAITING_PARTS',
          newStatus: 'IN_PROGRESS',
          actor: 'STAFF',
          changedByUserId: actor.id,
          reason: `Parts issued (${issued.part.sku} ×${request.quantity})`,
        },
      })
    }

    await this.audit(garage.id, actor.id, 'ISSUE_PART', issued.id, {
      partId: request.partId,
      quantity: request.quantity,
    })
    return issued
  }

  /**
   * Nothing in stock → the storekeeper flags the request ORDERED (procurement
   * pending); the request leaves the REQUESTED queue but stock is untouched.
   */
  async orderRequest(id: string, input: { supplierRef?: string; note?: string }, actor: { id: string }) {
    const garage = await this.currentGarage()
    const existing = await this.prisma.partRequest.findFirst({
      where: { id, garageId: garage.id },
      select: { id: true, status: true },
    })
    if (!existing) throw ApiError.notFound('PART_REQUEST_NOT_FOUND', 'Part request was not found.')
    if (existing.status !== 'REQUESTED') {
      throw new ApiError(
        'INVALID_PART_REQUEST_STATE',
        `Request is ${existing.status}; only REQUESTED parts can be marked ordered.`,
        409,
      )
    }
    const updated = await this.prisma.partRequest.update({
      where: { id },
      data: { status: 'ORDERED', decidedById: actor.id, decidedAt: new Date() },
      include: { part: { select: { sku: true, name: true } } },
    })
    await this.audit(garage.id, actor.id, 'ORDER_PART', id, { supplierRef: input.supplierRef })
    return updated
  }

  /** Mechanic/staff abort — allowed while nothing has been decided yet. */
  async cancelRequest(id: string, input: { note?: string }, actor: { id: string }) {
    const garage = await this.currentGarage()
    const existing = await this.prisma.partRequest.findFirst({
      where: { id, garageId: garage.id },
      select: { id: true, status: true, workOrderId: true },
    })
    if (!existing) throw ApiError.notFound('PART_REQUEST_NOT_FOUND', 'Part request was not found.')
    if (existing.status !== 'REQUESTED') {
      throw new ApiError(
        'INVALID_PART_REQUEST_STATE',
        `Request is ${existing.status}; only REQUESTED parts can be cancelled.`,
        409,
      )
    }
    const updated = await this.prisma.partRequest.update({
      where: { id },
      data: { status: 'CANCELLED', decidedById: actor.id, decidedAt: new Date() },
      include: { part: { select: { sku: true, name: true } } },
    })
    await this.audit(garage.id, actor.id, 'CANCEL_PART_REQUEST', id, { note: input.note })
    return updated
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async findPart(garageId: string, partId: string) {
    const part = await this.prisma.part.findFirst({
      where: { id: partId, garageId, deletedAt: null },
    })
    if (!part) throw ApiError.notFound('PART_NOT_FOUND', 'Part was not found.')
    return part
  }

  private async audit(
    garageId: string,
    actorId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    meta?: TransitionMeta,
  ) {
    const jsonMeta = metadata as Prisma.InputJsonValue
    await this.prisma.auditLog
      .create({
        data: {
          garageId,
          actorId,
          action,
          resourceType: 'PART',
          resourceId,
          requestId: meta?.requestId,
          ipAddress: meta?.ip,
          userAgent: meta?.userAgent?.slice(0, 255),
          metadata: jsonMeta,
        },
      })
      .catch(() => undefined)
  }
}
