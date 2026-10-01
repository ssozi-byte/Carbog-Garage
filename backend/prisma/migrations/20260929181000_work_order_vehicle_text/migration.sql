-- Phase 5A follow-up: guests check in without a linked vehicle row (the
-- booking captured free text only), so the work order mirrors the booking's
-- vehicle_id OR vehicle_text pattern instead of requiring the FK.
ALTER TABLE "work_orders" ALTER COLUMN "vehicle_id" DROP NOT NULL;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "vehicle_text" VARCHAR(120);
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_text_or_vehicle_id_check"
  CHECK ("vehicle_id" IS NOT NULL OR "vehicle_text" IS NOT NULL);
