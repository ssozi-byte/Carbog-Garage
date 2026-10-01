-- Phase 6 — car wash (docs/platform-roadmap-v2.md §2.2/§3): a wash is a WO
-- with type=WASH plus this ONE lightweight wash_jobs row (package = the
-- WASH-category service, current step, jsonb step audit trail). Kept in a
-- separate table so the wash step machine and the workshop machine never
-- bleed into each other. WASHER joins UserRole at MECHANIC rank.
--
-- NOTE: prisma migrate diff also emits legacy FK/timestamp churn (old
-- TIMESTAMP(3) tables, re-added FKs, refresh-sessions index rename) — that
-- standing drift is intentionally NOT part of this migration.

CREATE TYPE "WashStep" AS ENUM ('QUEUED', 'WASHING', 'VACUUMING', 'DETAILING', 'QUALITY_CHECK', 'READY');

ALTER TYPE "UserRole" ADD VALUE 'WASHER';

-- Wash packages join the service catalog (package = category=WASH service).
ALTER TYPE "ServiceCategory" ADD VALUE 'WASH';

CREATE TABLE "wash_jobs" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "washer_id" UUID,
    "current_step" "WashStep" NOT NULL DEFAULT 'QUEUED',
    "step_history" JSONB NOT NULL DEFAULT '[]',
    "last_step_event_id" UUID,
    "notes" VARCHAR(500),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "wash_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wash_jobs_work_order_id_key" ON "wash_jobs"("work_order_id");
CREATE UNIQUE INDEX "wash_jobs_last_step_event_id_key" ON "wash_jobs"("last_step_event_id");
CREATE INDEX "wash_jobs_garage_id_current_step_idx" ON "wash_jobs"("garage_id", "current_step");
CREATE INDEX "wash_jobs_washer_id_current_step_idx" ON "wash_jobs"("washer_id", "current_step");

ALTER TABLE "wash_jobs" ADD CONSTRAINT "wash_jobs_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wash_jobs" ADD CONSTRAINT "wash_jobs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wash_jobs" ADD CONSTRAINT "wash_jobs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wash_jobs" ADD CONSTRAINT "wash_jobs_washer_id_fkey" FOREIGN KEY ("washer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
