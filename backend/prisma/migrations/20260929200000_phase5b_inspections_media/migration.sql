-- Phase 5B: digital vehicle inspections + media (docs/platform-roadmap-v2.md §4)
-- Checklist templates/items, runs, offline-safe results, findings, media metadata.

CREATE TYPE "ResultStatus" AS ENUM ('GOOD', 'WATCH', 'NEEDS_ATTENTION', 'CRITICAL', 'NOT_CHECKED');
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'PROPOSED', 'SENT', 'APPROVED', 'DECLINED', 'DEFERRED');
CREATE TYPE "FindingSeverity" AS ENUM ('OK', 'WATCH', 'ATTENTION', 'CRITICAL');
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE TABLE "inspection_templates" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inspection_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "section" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "measurement_unit" VARCHAR(12),
    "allow_photo" BOOLEAN NOT NULL DEFAULT true,
    "watch_severity" "FindingSeverity",
    "needs_attention_severity" "FindingSeverity",
    "critical_severity" "FindingSeverity",

    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inspection_runs" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "conducted_by_id" UUID,
    "status" "ResultStatus",
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inspection_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "measurement" DECIMAL(10,2),
    "unit" VARCHAR(12),
    "note" VARCHAR(500),
    "photo_media_id" UUID,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inspection_findings" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "run_id" UUID,
    "result_id" UUID,
    "title" VARCHAR(140) NOT NULL,
    "customer_title" VARCHAR(140),
    "customer_explanation" VARCHAR(1000),
    "severity" "FindingSeverity" NOT NULL DEFAULT 'ATTENTION',
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "follow_up_at" TIMESTAMP(3),
    "decline_reason" VARCHAR(40),
    "recommendation" VARCHAR(300),
    "created_by_id" UUID,
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_findings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID,
    "tag" VARCHAR(40),
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(80) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "object_key" VARCHAR(320) NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inspection_templates_garage_id_is_active_idx" ON "inspection_templates"("garage_id", "is_active");
CREATE INDEX "inspection_items_template_id_display_order_idx" ON "inspection_items"("template_id", "display_order");
CREATE UNIQUE INDEX "inspection_runs_work_order_id_key" ON "inspection_runs"("work_order_id");
CREATE INDEX "inspection_runs_garage_id_work_order_id_idx" ON "inspection_runs"("garage_id", "work_order_id");
CREATE INDEX "inspection_results_run_id_idx" ON "inspection_results"("run_id");
CREATE UNIQUE INDEX "inspection_results_run_id_item_id_key" ON "inspection_results"("run_id", "item_id");
CREATE INDEX "inspection_findings_work_order_id_status_idx" ON "inspection_findings"("work_order_id", "status");
CREATE INDEX "inspection_findings_garage_id_status_idx" ON "inspection_findings"("garage_id", "status");
CREATE UNIQUE INDEX "media_files_object_key_key" ON "media_files"("object_key");
CREATE INDEX "media_files_entity_type_entity_id_idx" ON "media_files"("entity_type", "entity_id");
CREATE INDEX "media_files_garage_id_status_idx" ON "media_files"("garage_id", "status");

-- Align legacy index name with schema
ALTER INDEX "audit_logs_resource_idx" RENAME TO "audit_logs_resource_type_resource_id_idx";
