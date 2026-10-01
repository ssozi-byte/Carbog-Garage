-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'SMS', 'WHATSAPP', 'EMAIL');
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMED', 'CHECKED_IN', 'ESTIMATE_READY', 'ESTIMATE_APPROVED', 'ESTIMATE_DECLINED', 'WORK_STARTED', 'WORK_COMPLETED', 'READY_FOR_COLLECTION', 'PAYMENT_RECEIPT', 'WASH_READY', 'MANAGER_UPDATE', 'SERVICE_REMINDER');
-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'DISMISSED');
-- CreateEnum
CREATE TYPE "UpdateAudience" AS ENUM ('ALL_CUSTOMERS', 'SPECIFIC_CUSTOMER', 'SPECIFIC_VEHICLE', 'SPECIFIC_JOB', 'ALL_STAFF', 'MECHANICS', 'WASHERS');
-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'DUE', 'SENT', 'DISMISSED');
-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('MILEAGE', 'TIME');
-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "channels" "NotificationChannel"[] DEFAULT ARRAY['IN_APP']::"NotificationChannel"[],
    "customer_update_id" UUID,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "read_at" TIMESTAMPTZ(6),
    "dedupe_key" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "booking_id" UUID,
    "work_order_id" UUID,
    "estimate_id" UUID,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "customer_updates" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "audience" "UpdateAudience" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "attachment_media_id" UUID,
    "target_customer_id" UUID,
    "target_vehicle_id" UUID,
    "target_work_order_id" UUID,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "sent_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_updates_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "service_reminders" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "due_mileage" INTEGER,
    "due_date" DATE,
    "title" VARCHAR(160) NOT NULL,
    "notes" VARCHAR(500),
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(6),
    "sent_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "service_reminders_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
-- CreateIndex
CREATE INDEX "notifications_recipient_id_status_created_at_idx" ON "notifications"("recipient_id", "status", "created_at");
-- CreateIndex
CREATE INDEX "notifications_garage_id_type_created_at_idx" ON "notifications"("garage_id", "type", "created_at");
-- CreateIndex
CREATE INDEX "customer_updates_garage_id_audience_created_at_idx" ON "customer_updates"("garage_id", "audience", "created_at");
-- CreateIndex
CREATE INDEX "service_reminders_garage_id_status_idx" ON "service_reminders"("garage_id", "status");
-- CreateIndex
CREATE INDEX "service_reminders_vehicle_id_status_idx" ON "service_reminders"("vehicle_id", "status");
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_update_id_fkey" FOREIGN KEY ("customer_update_id") REFERENCES "customer_updates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_attachment_media_id_fkey" FOREIGN KEY ("attachment_media_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_target_customer_id_fkey" FOREIGN KEY ("target_customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_target_vehicle_id_fkey" FOREIGN KEY ("target_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "customer_updates" ADD CONSTRAINT "customer_updates_target_work_order_id_fkey" FOREIGN KEY ("target_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "service_reminders" ADD CONSTRAINT "service_reminders_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
