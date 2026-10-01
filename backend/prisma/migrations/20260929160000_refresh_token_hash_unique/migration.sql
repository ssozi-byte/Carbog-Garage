-- Phase 3 auth (follow-up): enforce one session row per refresh-token hash.
-- Rotation + reuse-detection rely on hash lookups; making the index unique
-- gives DB-level protection against duplicate active sessions.
DROP INDEX IF EXISTS "refresh_sessions_refresh_token_hash_idx";
CREATE UNIQUE INDEX "refresh_sessions_refresh_token_hash_key" ON "refresh_sessions"("refresh_token_hash");
