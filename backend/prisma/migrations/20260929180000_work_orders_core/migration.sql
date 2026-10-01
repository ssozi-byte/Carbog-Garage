-- Phase 5A: work orders — the job card (docs/platform-roadmap-v2.md §4)
-- Spawned at booking check-in; one vehicle visit = one work order.

CREATE TYPE "WorkOrderType" AS ENUM (
  'REPAIR', 'SERVICE', 'DIAGNOSTIC', 'WASH', 'DETAILING', 'INSPECTION_ONLY'
);

CREATE TYPE "WorkOrderStatus" AS ENUM (
  'PENDING', 'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL', 'APPROVED',
  'IN_PROGRESS', 'WAITING_PARTS', 'TESTING', 'QUALITY_CHECK',
  'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
);

CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "work_orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "garage_id" UUID NOT NULL REFERENCES "garages"("id"),
  "booking_id" UUID NOT NULL UNIQUE REFERENCES "bookings"("id"),
  "customer_id" UUID NOT NULL REFERENCES "users"("id"),
  "vehicle_id" UUID NOT NULL REFERENCES "vehicles"("id"),
  "wo_number" VARCHAR(24) NOT NULL UNIQUE,
  "type" "WorkOrderType" NOT NULL DEFAULT 'REPAIR',
  "status" "WorkOrderStatus" NOT NULL DEFAULT 'CHECKED_IN',
  "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
  -- Customer's original words (kept verbatim, distinct from diagnosis)
  "complaint" TEXT,
  -- Technician's short technical summary (distinct from the complaint)
  "diagnosis" TEXT,
  "assigned_technician_id" UUID REFERENCES "users"("id"),
  -- Physical bay for the live workshop board ("Bay 3", "Wash Bay 1")
  "bay_label" VARCHAR(40),
  "mileage_in" INTEGER,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "work_orders_garage_id_status_idx" ON "work_orders"("garage_id", "status");
CREATE INDEX "work_orders_assigned_technician_id_status_idx" ON "work_orders"("assigned_technician_id", "status");
CREATE INDEX "work_orders_status_priority_idx" ON "work_orders"("status", "priority");
CREATE INDEX "work_orders_customer_id_idx" ON "work_orders"("customer_id");
CREATE INDEX "work_orders_vehicle_id_idx" ON "work_orders"("vehicle_id");

-- Status changes with real actor identity (JWT → changed_by_user_id).
CREATE TABLE "work_order_status_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "work_order_id" UUID NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "old_status" "WorkOrderStatus",
  "new_status" "WorkOrderStatus" NOT NULL,
  "changed_by_user_id" UUID,
  "actor" "StatusActor" NOT NULL DEFAULT 'SYSTEM',
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "work_order_status_history_work_order_id_created_at_idx"
  ON "work_order_status_history"("work_order_id", "created_at");

-- Race-free WO-YYYY-NNNNNN generation (same pattern as booking_number_seq).
CREATE SEQUENCE "wo_number_seq" START 1;
