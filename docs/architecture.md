# MOTORA — System Architecture (Proposed)

> Status: **awaiting confirmation** before Phase 1 implementation.
> Sources: `frontend-analysis.md` (what the UI actually does today), platform spec §3–§66.

---

## 1. Topology

```text
                    INTERNET
                       │ HTTPS
                       ▼
        ┌──────────────────────────────┐
        │  MOTORA Frontend (existing)  │  React/Vite — untouched UX,
        │  motora.example              │  gains src/api/* + VITE_API_URL
        └──────────────┬───────────────┘
                       │ REST /api/v1 (JSON)
                       ▼
        ┌──────────────────────────────┐
        │      MOTORA Backend          │  NestJS modular monolith (§66)
        │  api.motora.example          │  Helmet, CORS allow-list, rate limits,
        │                              │  Swagger /docs, request-ID logging
        └───┬──────────┬─────────┬─────┘
            │          │         │
   ┌────────▼───┐ ┌────▼────┐ ┌──▼──────────────┐
   │ PostgreSQL │ │  Redis  │ │ S3-compatible   │
   │ (Prisma)   │ │ BullMQ  │ │ object storage  │
   └────────────┘ └────┬────┘ │ (private bucket)│
                       │      └─────────────────┘
              ┌────────┴─────────┐
              ▼                  ▼
      M-Pesa Daraja        SMS / WhatsApp / Email providers
      (STK push + callback)  (queued, retried, idempotent)
```

PostgreSQL/Redis/object storage are never exposed publicly; backend is the single gateway.

## 2. Stack (per spec §3)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript (strict) | |
| Framework | NestJS 10 (modular monolith) | REST + OpenAPI via Swagger |
| DB / ORM | PostgreSQL 16 + Prisma | migrations-only schema evolution |
| Auth | Argon2id, JWT access (15 min) + rotating refresh sessions, RBAC + object-level guards, TOTP MFA (ADMIN+) | one system only (§27) |
| Jobs | Redis + BullMQ | notifications, PDFs, reconciliation |
| Storage | S3-compatible (MinIO dev / cloud prod) | private bucket + signed URLs |
| Validation | zod DTO pipes | never trust frontend (§32) |
| Docs | Swagger/OpenAPI + `/docs` | contract kept in `api-contract.md` |

## 3. Backend module layout

```text
backend/src/
├── auth/  users/  garages/  customers/  vehicles/  services/
├── bookings/  diagnostics/  repairs/  inventory/  suppliers/
├── invoices/  payments/  mpesa/  notifications/  whatsapp/  sms/
├── media/  reports/  audit/  security/  privacy/  health/
├── common/{decorators,guards,filters,interceptors,pipes,middleware,utils}
├── config/  database/  jobs/
├── app.module.ts  main.ts
```

Each module = controller(s) + service + DTOs; cross-cutting concerns (tenant scoping, audit, error mapping, logging) live in `common/`. Module boundaries are kept clean so extraction into services is possible later — but we ship **one deployable** (§66).

## 4. Tenancy & authorization model

- **Tenant key:** `garageId` on every garage-owned row. Staff `garageId` is embedded in JWT at login and re-verified against the DB guard — never read from request bodies (§29).
- **Two-layer authz:** role guard (RBAC: CUSTOMER → SUPER_ADMIN) **then** object guard (row ownership/garage scope). Cross-tenant object access → 404 (existence hidden); same-garage role failure → 403.
- **Customer isolation:** customers see only rows where `customerId = self`; diagnostic findings filtered to `customerVisible=true` unless published.
- Public endpoints (garage profile, services, testimonials, gallery) read seeded content with 60s cache and aggressive rate limits.

## 5. Key request flows

### 5.1 Booking quote request (maps to today's contact form)
```text
ContactPage form → POST /api/v1/bookings/quote-request {name, phone, vehicleText?, serviceName?, message?}
→ rate limit (3/10min/IP) + zod validation (phone E.164-KE)
→ tx: upsert user by phone (PENDING_VERIFICATION) → ensure customer_profile → create vehicle_text booking
→ booking_number MOT-2026-NNNNN, status REQUESTED, history row, audit log
→ enqueue SMS/WhatsApp confirmation (BullMQ) → 201 {bookingNumber}
→ staff dashboard lists REQUESTED bookings
```

### 5.2 M-Pesa STK payment (server-authoritative, §21/§62)
```text
Frontend → POST /payments/mpesa/stk-push {invoiceId, amount?, phone?}
→ backend: object authz (own invoice) → amount := min(requested, balanceDue) (server-cap)
→ create payment (idempotency_key unique) → Daraja OAuth → STK push → status INITIATED
→ Daraja callback → verify → payment_events (payload_hash, unique (provider,external_event_id)) → duplicate = no-op
→ tx: payment COMPLETED + invoice.amountPaid/balanceDue/status + audit
→ frontend polls GET /payments/:id for authoritative status (never trusts its own success UI)
```

### 5.3 Status transition
```text
POST /bookings/:id/status → role guard → load booking (garage-scoped)
→ state machine table check (INVALID_STATUS_TRANSITION on illegal move)
→ tx: update status + booking_status_history + audit → enqueue customer notification
```

## 6. Security baseline (defense-in-depth, §53)

- Helmet + HSTS; explicit CORS allow-list from env (`FRONTEND_URL`); no wildcard in prod.
- Argon2id; login throttle 5/15min/IP+identifier with lockout escalation; all attempts logged.
- Refresh rotation + revocation + session listing/kill; token hashes only in DB.
- Rate limits per route class; body size caps; pagination capped at 100.
- Central exception filter → stable error codes (`BOOKING_NOT_FOUND`, `INVALID_STATUS_TRANSITION`, …); no stack traces/SQL ever leave.
- Structured logs with `requestId`; audit_logs append-only; security_events for auth/payment anomalies.
- Secrets only in env/secret manager; `.env.example` committed, `.env` ignored; nothing prefixed `VITE_` except `VITE_API_URL`.
- M-Pesa: consumer secret/passkey backend-only; callbacks authenticated, hashed, idempotent; amounts capped server-side; frontend success never authoritative.
- File uploads: presigned PUT, MIME/extension/size/magic-byte validation, private storage, 300s signed GETs.

## 7. Data protection (Kenya DPA, §39–40)

Minimal PII (name, phone, vehicle, booking data). Separate consents (SERVICE_COMMUNICATION vs MARKETING_*) with versioned, append-only `consents` history. Retention: booking/financial records retained per business/legal need; contact messages and failed-login data TTL'd. Privacy policy, ToS, DSAR (access/correct/delete) workflow documented in `security.md` before launch; third-party processors (Safaricom, SMS/WhatsApp provider, storage) listed with cross-border notes. Legal review flagged as pre-launch requirement.

## 8. Delivery phases (§64) — status

| Phase | Scope | State |
|---|---|---|
| 0 | Frontend inspection → `frontend-analysis.md` | ✅ done |
| 0 | `database.md`, `api-contract.md`, this doc | ✅ done |
| 1 | NestJS scaffold, config, logging, validation, Swagger, health, Docker | next — after confirmation |
| 2 | Prisma schema + migrations + seed (garage, services, staff, content) | |
| 3 | Auth (register/login/refresh/sessions/MFA) + tests | |
| 4 | Bookings + status machine + **wire contact form** to `/bookings/quote-request` | |
| 5 | Diagnostics, repairs, inventory, suppliers | |
| 6 | Invoices, payments, payment events | |
| 7 | M-Pesa Daraja (sandbox) + callback idempotency | |
| 8 | Notifications (SMS/WhatsApp/Email via BullMQ) | |
| 9 | Media (private S3, signed URLs) | |
| 10 | Admin dashboard + reports APIs | |
| 11 | Security hardening + test suite (authz/IDOR/rate/SQLi/upload/payment) | |
| 12 | Production (HTTPS, secrets, backups, CI/CD, monitoring) | |

## 9. CI (§60)

GitHub Actions: lint → typecheck → unit → integration (Postgres+Redis services) → build → `npm audit` → migration check (`prisma migrate diff`). All green required to merge/deploy. Backups: nightly `pg_dump` + WAL, 30-day retention, **documented + tested restore runbook** (`deployment.md`, Phase 12).
