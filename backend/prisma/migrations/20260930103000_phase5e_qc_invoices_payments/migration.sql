-- Phase 5E — quality control + invoicing + payments (roadmap v2 §4/§15,
-- docs/database.md §2.16–2.20). Money is integer KES cents; invoice totals
-- are always backend-computed; corrections are new rows (VOID / REVERSAL),
-- never edits. Callback replay is rejected via payload hash + the
-- UNIQUE (provider, external_event_id) pair.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REFUNDED');


-- CreateEnum
CREATE TYPE "InvoiceItemType" AS ENUM ('SERVICE', 'PART', 'OTHER');


-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MPESA', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER');


-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED', 'REFUNDED');


-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('STK_CALLBACK', 'TIMEOUT', 'RECONCILIATION', 'MANUAL');


-- CreateEnum
CREATE TYPE "MpesaRequestStatus" AS ENUM ('SENT', 'CALLBACK_RECEIVED', 'TIMEOUT', 'FAILED');


-- CreateTable
CREATE TABLE "quality_checks" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "repair_completed" BOOLEAN NOT NULL DEFAULT false,
    "parts_installed" BOOLEAN NOT NULL DEFAULT false,
    "no_leaks" BOOLEAN NOT NULL DEFAULT false,
    "warning_lights" BOOLEAN NOT NULL DEFAULT false,
    "test_drive" BOOLEAN NOT NULL DEFAULT false,
    "tools_removed" BOOLEAN NOT NULL DEFAULT false,
    "vehicle_cleaned" BOOLEAN NOT NULL DEFAULT false,
    "belongings_checked" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(500),
    "approved" BOOLEAN,
    "rejected_reason" VARCHAR(300),
    "checked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "booking_id" UUID,
    "customer_id" UUID NOT NULL,
    "invoice_number" VARCHAR(24) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_paid_cents" INTEGER NOT NULL DEFAULT 0,
    "balance_due_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'KES',
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "item_type" "InvoiceItemType" NOT NULL DEFAULT 'OTHER',
    "description" VARCHAR(300) NOT NULL,
    "qty_milli" INTEGER NOT NULL DEFAULT 1000,
    "unit_price_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "service_id" UUID,
    "part_id" UUID,
    "estimate_item_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'KES',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "provider_transaction_id" VARCHAR(100),
    "mpesa_receipt" VARCHAR(40),
    "phone_number" VARCHAR(20),
    "idempotency_key" VARCHAR(80) NOT NULL,
    "reverses_payment_id" UUID,
    "initiated_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "provider" VARCHAR(20) NOT NULL,
    "event_type" "PaymentEventType" NOT NULL,
    "external_event_id" VARCHAR(100),
    "payload_hash" VARCHAR(64) NOT NULL,
    "payload_metadata" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "mpesa_requests" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "phone_number" VARCHAR(20) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "merchant_request_id" VARCHAR(100),
    "checkout_request_id" VARCHAR(100),
    "status" "MpesaRequestStatus" NOT NULL DEFAULT 'SENT',
    "result_code" INTEGER,
    "result_desc" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpesa_requests_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "quality_checks_work_order_id_created_at_idx" ON "quality_checks"("work_order_id", "created_at");

-- CreateIndex
CREATE INDEX "quality_checks_garage_id_approved_idx" ON "quality_checks"("garage_id", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_work_order_id_key" ON "invoices"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_garage_id_status_idx" ON "invoices"("garage_id", "status");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_provider_transaction_id_idx" ON "payments"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_events_payload_hash_idx" ON "payment_events"("payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_external_event_id_key" ON "payment_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "mpesa_requests_checkout_request_id_idx" ON "mpesa_requests"("checkout_request_id");

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- M-Pesa receipts are unique where present (docs/database.md §2.18).
CREATE UNIQUE INDEX "payments_mpesa_receipt_key" ON "payments"("mpesa_receipt") WHERE "mpesa_receipt" IS NOT NULL;

-- A payment is always a positive amount of money (docs/database.md §2.18).
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_cents_check" CHECK ("amount_cents" > 0);

-- Human invoice references, INV-YYYY-NNNNNN (same pattern as wo_number_seq).
CREATE SEQUENCE "invoice_number_seq" START 1;
