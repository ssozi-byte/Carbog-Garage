-- Race-free booking numbers: a single Postgres sequence formatted as
-- MOT-YYYY-NNNNNN at the application layer (gaps are fine, collisions are not).
CREATE SEQUENCE IF NOT EXISTS booking_number_seq START 1;
