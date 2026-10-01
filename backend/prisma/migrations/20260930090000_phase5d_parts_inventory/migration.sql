-- Phase 5D — parts & inventory (roadmap v2 §4 "Parts (§13)").
-- parts + inventory_transactions follow docs/database.md §2.12–2.13; the
-- v2 additions are parts_requests (mechanic ask → storekeeper issue).
-- inventory_transactions is append-only: every stock change writes one row
-- in the same DB transaction as the parts.quantity_on_hand update.

-- CreateEnum
CREATE TYPE "PartRequestStatus" AS ENUM ('REQUESTED', 'ISSUED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('PURCHASE', 'SALE', 'REPAIR_USAGE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER');

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "manufacturer" VARCHAR(120),
    "part_number" VARCHAR(80),
    "description" VARCHAR(500),
    "unit_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "selling_price_cents" INTEGER NOT NULL DEFAULT 0,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "supplier_ref" VARCHAR(160),
    "transaction_type" "InventoryTxType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "reference" VARCHAR(160),
    "performed_by_id" UUID,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_requests" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "PartRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" VARCHAR(300),
    "unit_price_at_issue_cents" INTEGER,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parts_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parts_garage_id_is_active_idx" ON "parts"("garage_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "parts_garage_id_sku_key" ON "parts"("garage_id", "sku");

-- CreateIndex
CREATE INDEX "inventory_transactions_part_id_idx" ON "inventory_transactions"("part_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_garage_id_created_at_idx" ON "inventory_transactions"("garage_id", "created_at");

-- CreateIndex
CREATE INDEX "parts_requests_work_order_id_status_idx" ON "parts_requests"("work_order_id", "status");

-- CreateIndex
CREATE INDEX "parts_requests_part_id_idx" ON "parts_requests"("part_id");

-- CreateIndex
CREATE INDEX "parts_requests_garage_id_status_idx" ON "parts_requests"("garage_id", "status");

-- CreateIndex
CREATE INDEX "parts_requests_requested_by_id_idx" ON "parts_requests"("requested_by_id");

-- Stock can never go negative (docs/database.md §2.12); also enforced in the
-- service layer with a conditional update so concurrent issues stay safe.
ALTER TABLE "parts" ADD CONSTRAINT "parts_quantity_on_hand_check" CHECK ("quantity_on_hand" >= 0);

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_requests" ADD CONSTRAINT "parts_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
