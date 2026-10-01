-- Phase 3: authentication (sessions, throttling, MFA, security events)

-- 1) Refresh-token sessions (rotation + revocation, §27)
CREATE TABLE "refresh_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "refresh_token_hash" VARCHAR(64) NOT NULL,          -- sha256 hex of opaque token
  "device_label" VARCHAR(120),
  "ip" VARCHAR(45),
  "user_agent" VARCHAR(255),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_reason" VARCHAR(40),
  "rotated_from_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");
CREATE INDEX "refresh_sessions_refresh_token_hash_idx" ON "refresh_sessions"("refresh_token_hash");

-- 2) Login attempts (throttle + lockout evidence)
CREATE TABLE "login_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" VARCHAR(255) NOT NULL,
  "user_id" UUID,
  "success" BOOLEAN NOT NULL,
  "ip" VARCHAR(45),
  "user_agent" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "login_attempts_identifier_created_at_idx" ON "login_attempts"("identifier", "created_at");
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- 3) MFA factors (TOTP, secret stored AES-256-GCM encrypted)
CREATE TYPE "MfaFactorType" AS ENUM ('TOTP');
CREATE TABLE "mfa_factors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "MfaFactorType" NOT NULL DEFAULT 'TOTP',
  "secret_encrypted" TEXT NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "last_used_at" TIMESTAMPTZ(3),
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mfa_factors_user_id_idx" ON "mfa_factors"("user_id");

-- 4) Security events (§38)
CREATE TYPE "SecurityEventType" AS ENUM (
  'FAILED_LOGIN', 'ACCOUNT_LOCKOUT', 'SUSPICIOUS_ACCESS', 'INVALID_TOKEN',
  'RATE_LIMIT_EXCEEDED', 'UNAUTHORIZED_RESOURCE_ACCESS', 'MULTIPLE_FAILED_PAYMENT_ATTEMPTS'
);
CREATE TABLE "security_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "garage_id" UUID,
  "user_id" UUID,
  "event_type" "SecurityEventType" NOT NULL,
  "resource" VARCHAR(120),
  "ip" VARCHAR(45),
  "user_agent" VARCHAR(255),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "security_events_event_type_created_at_idx" ON "security_events"("event_type", "created_at");
CREATE INDEX "security_events_user_id_created_at_idx" ON "security_events"("user_id", "created_at");
