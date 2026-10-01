-- Phase 4: bookings core (guest quote requests)
-- 1) guests may exist without passwords (Phase 3 auth sets them later)
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- 2) booking status enum
CREATE TYPE "BookingStatus" AS ENUM (
  'REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'INSPECTION', 'AWAITING_APPROVAL',
  'APPROVED', 'IN_PROGRESS', 'READY_FOR_COLLECTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
);
CREATE TYPE "StatusActor" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- 3) bookings
CREATE TABLE "bookings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "garage_id" UUID NOT NULL REFERENCES "garages"("id"),
  "customer_id" UUID NOT NULL REFERENCES "users"("id"),
  "vehicle_id" UUID REFERENCES "vehicles"("id"),
  "vehicle_text" VARCHAR(120),
  "booking_number" VARCHAR(24) NOT NULL UNIQUE,
  "scheduled_date" DATE,
  "scheduled_time" TIME,
  "status" "BookingStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_service_name" VARCHAR(140),
  "service_id" UUID REFERENCES "services"("id"),
  "customer_notes" TEXT,
  "internal_notes" TEXT,
  "estimated_cost" INTEGER,
  "approved_cost" INTEGER,
  "actual_cost" INTEGER,
  "cancelled_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookings_vehicle_text_or_vehicle_id_check"
    CHECK ("vehicle_id" IS NOT NULL OR "vehicle_text" IS NOT NULL)
);

CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");
CREATE INDEX "bookings_garage_id_status_idx" ON "bookings"("garage_id", "status");
CREATE INDEX "bookings_status_idx" ON "bookings"("status");
CREATE INDEX "bookings_scheduled_date_idx" ON "bookings"("scheduled_date");

-- 4) status history (append-only trail, §12)
CREATE TABLE "booking_status_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "old_status" "BookingStatus",
  "new_status" "BookingStatus" NOT NULL,
  "changed_by_user_id" UUID REFERENCES "users"("id"),
  "actor" "StatusActor" NOT NULL DEFAULT 'SYSTEM',
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "booking_status_history_booking_id_created_at_idx"
  ON "booking_status_history"("booking_id", "created_at");

-- 5) audit log (append-only, §37)
CREATE TABLE "audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "garage_id" UUID,
  "actor_id" UUID,
  "action" VARCHAR(60) NOT NULL,
  "resource_type" VARCHAR(40),
  "resource_id" VARCHAR(64),
  "request_id" VARCHAR(64),
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(255),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource_type", "resource_id");
CREATE INDEX "audit_logs_garage_id_created_at_idx" ON "audit_logs"("garage_id", "created_at");
