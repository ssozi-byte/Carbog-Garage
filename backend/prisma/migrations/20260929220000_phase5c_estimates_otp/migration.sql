-- Phase 5C — estimates & approvals + OTP phone sign-in (roadmap v2 §4).
-- Money is integer KES cents; quantities are thousandths (no floats).
-- estimate_approvals is append-only: no updates/deletes ever (enforced by
-- the service layer; the ledger IS the approval history).

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EstimateItemKind" AS ENUM ('PART', 'LABOUR');

-- CreateEnum
CREATE TYPE "EstimateApprovalAction" AS ENUM ('SENT', 'VIEWED', 'APPROVED', 'DECLINED', 'REVISED', 'RE_APPROVED');

-- CreateEnum
CREATE TYPE "EstimateActorType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "EstimateDeclineReason" AS ENUM ('TOO_EXPENSIVE', 'LATER', 'NEED_INFO', 'OTHER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('ESTIMATE_APPROVAL');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'MAXED_OUT');

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "estimate_number" VARCHAR(24) NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "finding_id" UUID,
    "kind" "EstimateItemKind" NOT NULL DEFAULT 'LABOUR',
    "description" VARCHAR(300) NOT NULL,
    "qty_milli" INTEGER NOT NULL DEFAULT 1000,
    "unit_price_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_approvals" (
    "id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "action" "EstimateApprovalAction" NOT NULL,
    "actor_id" UUID,
    "actor_type" "EstimateActorType" NOT NULL DEFAULT 'STAFF',
    "decline_reason" "EstimateDeclineReason",
    "note" VARCHAR(500),
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "via" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'ESTIMATE_APPROVAL',
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "estimate_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estimates_work_order_id_key" ON "estimates"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_estimate_number_key" ON "estimates"("estimate_number");

-- CreateIndex
CREATE INDEX "estimates_garage_id_status_idx" ON "estimates"("garage_id", "status");

-- CreateIndex
CREATE INDEX "estimates_work_order_id_idx" ON "estimates"("work_order_id");

-- CreateIndex
CREATE INDEX "estimate_items_estimate_id_idx" ON "estimate_items"("estimate_id");

-- CreateIndex
CREATE INDEX "estimate_items_finding_id_idx" ON "estimate_items"("finding_id");

-- CreateIndex
CREATE INDEX "estimate_approvals_estimate_id_created_at_idx" ON "estimate_approvals"("estimate_id", "created_at");

-- CreateIndex
CREATE INDEX "estimate_approvals_action_idx" ON "estimate_approvals"("action");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_status_idx" ON "otp_codes"("phone", "purpose", "status");

-- CreateIndex
CREATE INDEX "otp_codes_estimate_id_idx" ON "otp_codes"("estimate_id");

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "inspection_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Race-free estimate numbers: EST-YYYY-NNNNNN from a dedicated sequence
-- (same pattern as booking_number_seq / wo_number_seq).
CREATE SEQUENCE "estimate_number_seq" START 1;
