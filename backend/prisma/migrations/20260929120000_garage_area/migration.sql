-- Add area (neighborhood) to garages for location display
ALTER TABLE "garages" ADD COLUMN "area" TEXT;

-- Backfill from seed context (MOTORA Kilimani)
UPDATE "garages" SET "area" = 'Kilimani' WHERE slug = 'motora-kilimani' AND "area" IS NULL;
