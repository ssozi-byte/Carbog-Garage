-- Phase 5E follow-up: estimate PART lines may reference the catalog part
-- they price. Invoicing dedupes issued units against priced lines PER PART
-- via this link (qty already priced is not billed twice).

-- AlterTable
ALTER TABLE "estimate_items" ADD COLUMN "part_id" UUID;

-- CreateIndex
CREATE INDEX "estimate_items_part_id_idx" ON "estimate_items"("part_id");

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
