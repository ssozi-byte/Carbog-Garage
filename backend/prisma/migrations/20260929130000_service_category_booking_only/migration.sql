-- Add BOOKING_ONLY category (catalog entries not shown on marketing surfaces)
ALTER TYPE "ServiceCategory" ADD VALUE IF NOT EXISTS 'BOOKING_ONLY';
