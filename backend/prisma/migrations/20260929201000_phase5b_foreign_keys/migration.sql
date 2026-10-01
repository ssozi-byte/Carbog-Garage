-- Phase 5B follow-up: foreign keys for the inspection/media tables.
-- The 5B migration was extracted from a schema diff and the FK block was
-- lost in extraction; this restores referential integrity. DROP IF EXISTS
-- keeps it idempotent.

ALTER TABLE "inspection_templates" DROP CONSTRAINT IF EXISTS "inspection_templates_garage_id_fkey";
ALTER TABLE "inspection_templates"
  ADD CONSTRAINT "inspection_templates_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_items" DROP CONSTRAINT IF EXISTS "inspection_items_template_id_fkey";
ALTER TABLE "inspection_items"
  ADD CONSTRAINT "inspection_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inspection_runs" DROP CONSTRAINT IF EXISTS "inspection_runs_work_order_id_fkey";
ALTER TABLE "inspection_runs"
  ADD CONSTRAINT "inspection_runs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_runs" DROP CONSTRAINT IF EXISTS "inspection_runs_template_id_fkey";
ALTER TABLE "inspection_runs"
  ADD CONSTRAINT "inspection_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_runs" DROP CONSTRAINT IF EXISTS "inspection_runs_conducted_by_id_fkey";
ALTER TABLE "inspection_runs"
  ADD CONSTRAINT "inspection_runs_conducted_by_id_fkey" FOREIGN KEY ("conducted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inspection_results" DROP CONSTRAINT IF EXISTS "inspection_results_run_id_fkey";
ALTER TABLE "inspection_results"
  ADD CONSTRAINT "inspection_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "inspection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inspection_results" DROP CONSTRAINT IF EXISTS "inspection_results_item_id_fkey";
ALTER TABLE "inspection_results"
  ADD CONSTRAINT "inspection_results_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inspection_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_results" DROP CONSTRAINT IF EXISTS "inspection_results_photo_media_id_fkey";
ALTER TABLE "inspection_results"
  ADD CONSTRAINT "inspection_results_photo_media_id_fkey" FOREIGN KEY ("photo_media_id") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inspection_findings" DROP CONSTRAINT IF EXISTS "inspection_findings_work_order_id_fkey";
ALTER TABLE "inspection_findings"
  ADD CONSTRAINT "inspection_findings_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_findings" DROP CONSTRAINT IF EXISTS "inspection_findings_run_id_fkey";
ALTER TABLE "inspection_findings"
  ADD CONSTRAINT "inspection_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "inspection_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inspection_findings" DROP CONSTRAINT IF EXISTS "inspection_findings_result_id_fkey";
ALTER TABLE "inspection_findings"
  ADD CONSTRAINT "inspection_findings_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "inspection_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_files" DROP CONSTRAINT IF EXISTS "media_files_garage_id_fkey";
ALTER TABLE "media_files"
  ADD CONSTRAINT "media_files_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
