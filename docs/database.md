# MOTORA — Database Specification (PostgreSQL + Prisma)

> Derived from `docs/frontend-analysis.md` + platform spec §5–§28, §37–§48.
> Prisma implementation: `backend/prisma/schema.prisma` (Phase 2). All PKs are UUID v4 (Prisma `@default(uuid())`).
> Money is stored as **integer minor units** (KES cents) — never floats. Currency is a column (`default "KES"`), never hardcoded in logic.

---

## 0. Conventions

- UUID PKs; FKs with explicit referential actions (`onDelete`).
- `createdAt` / `updatedAt` on every table (`now()` / auto-update).
- Soft delete via `deletedAt DateTime?` **only where history must survive** (users, customers, vehicles, services, parts, suppliers). Financial/audit records are **never** hard-deleted (§48).
- Enums are Postgres enums via Prisma `enum` — no free-text status columns.
- Every garage-owned table carries `garageId` — the tenant key. **All** staff queries filter by it; customers implicitly by ownership.
- Money columns: `subtotal, discount, tax, total, amountPaid, balanceDue, basePrice, unitCost, sellingPrice, estimatedCost, approvedCost, actualCost, amount` → `Int` (KES cents).
- CHECK-style constraints expressed via Prisma + service-layer validation (e.g. quantity > 0, amount >= 0); DB-level CHECKs added in raw migration SQL where critical (invoice totals, payment amount > 0).

---

## 1. ERD (Mermaid)

```mermaid
erDiagram
    GARAGES ||--o{ USERS : employs
    GARAGES ||--o{ SERVICES : offers
    GARAGES ||--o{ VEHICLES : owns-record-of
    GARAGES ||--o{ PARTS : stocks
    GARAGES ||--o{ SUPPLIERS : buys-from
    GARAGES ||--o{ TESTIMONIALS : collects
    GARAGES ||--o{ GALLERY_ITEMS : publishes
    GARAGES ||--o{ MEDIA_FILES : stores
    GARAGES ||--o{ GARAGE_HOURS : operates
    GARAGES ||--o{ BOOKINGS : serves
    GARAGES ||--o{ INVOICES : bills
    GARAGES ||--o{ PAYMENTS : receives
    GARAGES ||--o{ AUDIT_LOGS : audits

    USERS ||--o| CUSTOMER_PROFILES : has
    USERS ||--o{ VEHICLES : owns
    USERS ||--o{ BOOKINGS : books
    USERS ||--o{ BOOKING_STATUS_HISTORY : changes
    USERS ||--o{ REPAIR_JOBS : assigned-to
    USERS ||--o{ DIAGNOSTIC_REPORTS : writes
    USERS ||--o{ MEDIA_FILES : uploads
    USERS ||--o{ REFRESH_SESSIONS : holds
    USERS ||--o{ MF A_FACTORS : enrolls
    USERS ||--o{ CONSENTS : grants
    USERS ||--o{ AUDIT_LOGS : acts-in

    USERS ||--o{ BOOKINGS : "customer"
    VEHICLES ||--o{ BOOKINGS : subject-of
    BOOKINGS ||--o{ BOOKING_STATUS_HISTORY : tracks
    BOOKINGS ||--o| DIAGNOSTIC_REPORTS : produces
    BOOKINGS ||--o{ REPAIR_JOBS : breaks-into
    BOOKINGS ||--o{ INVOICES : bills-into
    BOOKINGS ||--o{ PAYMENTS : pays-via
    BOOKINGS ||--o{ MEDIA_FILES : documents

    DIAGNOSTIC_REPORTS ||--o{ DIAGNOSTIC_FINDINGS : lists
    DIAGNOSTIC_REPORTS ||--o{ MEDIA_FILES : attaches
    REPAIR_JOBS }o--|| SERVICES : of-type
    REPAIR_JOBS ||--o{ PART_USAGES : consumes
    PARTS ||--o{ PART_USAGES : used-in
    PARTS ||--o{ INVENTORY_TRANSACTIONS : moves
    SUPPLIERS ||--o{ INVENTORY_TRANSACTIONS : supplies
    SUPPLIERS ||--o{ PARTS : sources

    INVOICES ||--o{ INVOICE_ITEMS : itemizes
    INVOICES ||--o{ PAYMENTS : settled-by
    INVOICES ||--o{ PAYMENTS : has
    PAYMENTS ||--o{ PAYMENT_EVENTS : receives
    SERVICE_BOOKING_LINK }o--|| SERVICES : books
    SERVICE_BOOKING_LINK }o--|| BOOKINGS : for
    GALLERY_ITEMS ||--o{ MEDIA_FILES : shows
```

*(Typo guard: `MF A_FACTORS` = `MFA_FACTORS`.)*

---

## 2. Tables

### 2.1 garages
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL |
| slug | text | UNIQUE NOT NULL |
| phone / email / address / city / county | text | NOT NULL |
| country | text | NOT NULL default 'Kenya' |
| latitude / longitude | decimal(10,8) / decimal(11,8) | nullable |
| whatsapp_number | text | nullable |
| timezone | text | NOT NULL default 'Africa/Nairobi' |
| currency | text | NOT NULL default 'KES' |
| brands_serviced | text[] | default '{}' (display-only list) |
| stats | jsonb | nullable (marketing stats — display-only, not business data) |
| status | enum garage_status | ACTIVE / INACTIVE / SUSPENDED |
| created_at / updated_at | timestamptz | NOT NULL |

### 2.2 garage_hours
id uuid PK · garage_id FK→garages ON DELETE CASCADE · day_of_week smallint 0–6 NOT NULL · opens_at time · closes_at time · is_closed boolean default false. UNIQUE (garage_id, day_of_week). Index (garage_id).

### 2.3 users
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| garage_id | uuid FK→garages | NULL for CUSTOMER signups outside a garage? **No —** customers belong to the garage they book with; NOT NULL (seed garage). SUPER_ADMIN may be per-garage with global perms. |
| phone | text | UNIQUE (normalized E.164), NOT NULL |
| email | text | UNIQUE (lowercased), nullable (phone-first market) |
| password_hash | text | NOT NULL — Argon2id |
| first_name / last_name | text | NOT NULL |
| role | enum user_role | CUSTOMER / MECHANIC / SERVICE_ADVISOR / INVENTORY_MANAGER / CASHIER / ADMIN / SUPER_ADMIN |
| status | enum user_status | PENDING_VERIFICATION / ACTIVE / SUSPENDED / LOCKED |
| email_verified_at / phone_verified_at | timestamptz | nullable |
| last_login_at | timestamptz | nullable |
| failed_login_count | int | default 0 (throttle/lockout) |
| locked_until | timestamptz | nullable |
| mfa_enforced | boolean | default false (true for ADMIN+) |
| created_at / updated_at / deleted_at | timestamptz | soft delete |

Indexes: email, phone, (garage_id, role).

### 2.4 customer_profiles
id PK · user_id FK→users UNIQUE ON DELETE CASCADE · garage_id FK · address text · city text · notes text (staff-only) · marketing_optin boolean default false · created_at/updated_at. Index (garage_id).

### 2.5 vehicles
id PK · garage_id FK · customer_id FK→users · registration_number text NOT NULL (**normalized** `KDA 123A` → stored `KDA123A` uppercase alnum; display formatter adds space) · make text NOT NULL · model text NOT NULL · year smallint CHECK 1980–2100 · vin text UNIQUE nullable · engine_number text nullable · fuel_type enum PETROL/DIESEL/HYBRID/ELECTRIC nullable · transmission enum MANUAL/AUTOMATIC nullable · mileage int nullable · notes text · created_at/updated_at/deleted_at. UNIQUE (garage_id, registration_number, customer_id). Indexes: registration_number, customer_id, garage_id.

### 2.6 services
id PK · garage_id FK · name text NOT NULL · slug text NOT NULL · description text · icon_key text (maps to frontend icon set) · display_num text ('01'… — preserves current UI ordering) · points text[] (frontend bullet list) · category enum CORE/EXTRA · estimated_duration_minutes int · base_price int (cents) · currency text default 'KES' · is_active boolean default true · display_order int · created_at/updated_at. UNIQUE (garage_id, slug). Index (garage_id, is_active).

### 2.7 bookings
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| garage_id | uuid FK | tenant |
| customer_id | uuid FK→users | NOT NULL (guest requests create a user w/ PENDING_VERIFICATION or reuse by phone) |
| vehicle_id | uuid FK→vehicles | nullable for guest quote-requests (M1) |
| vehicle_text | text | raw "Toyota Fielder 2016" for guests — M1 |
| booking_number | text | UNIQUE — `MOT-2026-000123` (seq per garage per year) |
| scheduled_date | date | nullable (M3: quote requests have no slot) |
| scheduled_time | time | nullable |
| status | enum booking_status | see §2.8 |
| customer_notes | text | form "Describe the issue" |
| requested_service_name | text | raw select value from current form (M2 bridge) |
| internal_notes | text | staff-only |
| estimated_cost / approved_cost / actual_cost | int cents | nullable — backend-calculated only |
| cancelled_at / completed_at | timestamptz | nullable |
| created_at / updated_at | timestamptz | |

Indexes: customer_id, vehicle_id, status, scheduled_date, booking_number(unique), (garage_id, status).

### 2.8 booking_status_history
id PK · booking_id FK CASCADE · old_status enum nullable · new_status enum NOT NULL · changed_by FK→users nullable (system) · reason text · created_at. Index (booking_id, created_at). **State machine enforced in `bookings` domain service** — legal transitions table below; anything else → `INVALID_STATUS_TRANSITION`.

```text
REQUESTED → CONFIRMED | CANCELLED
CONFIRMED → CHECKED_IN | NO_SHOW | CANCELLED
CHECKED_IN → INSPECTION
INSPECTION → AWAITING_APPROVAL | IN_PROGRESS | CANCELLED
AWAITING_APPROVAL → APPROVED | CANCELLED
APPROVED → IN_PROGRESS
IN_PROGRESS → READY_FOR_COLLECTION
READY_FOR_COLLECTION → COMPLETED
CANCELLED, NO_SHOW, COMPLETED → terminal
```

### 2.9 diagnostic_reports / 2.10 diagnostic_findings
report: id PK · booking_id FK UNIQUE · mechanic_id FK→users · summary text · published_at timestamptz nullable (explicit publish) · created_at/updated_at.
finding: id PK · diagnostic_report_id FK CASCADE · category enum ENGINE/BRAKES/SUSPENSION/ELECTRICAL/AC/OTHER · severity enum INFO/LOW/MEDIUM/HIGH/CRITICAL · finding text NOT NULL · recommendation text · estimated_cost int nullable · customer_visible boolean default false · created_at.

### 2.11 repair_jobs
id PK · garage_id FK · booking_id FK · assigned_mechanic_id FK→users nullable · service_id FK→services nullable · description text · status enum PENDING/ASSIGNED/IN_PROGRESS/WAITING_FOR_PARTS/WAITING_FOR_APPROVAL/COMPLETED/CANCELLED · estimated_hours numeric(5,2) · actual_hours numeric(5,2) · estimated_cost/actual_cost int cents · started_at/completed_at · created_at/updated_at. Index (booking_id, status).

### 2.12 parts
id PK · garage_id FK · sku text NOT NULL · name NOT NULL · manufacturer · part_number · description · unit_cost/selling_price int cents · quantity_on_hand int NOT NULL default 0 (CHECK >= 0) · reorder_level int default 0 · is_active bool · created_at/updated_at/deleted_at. UNIQUE (garage_id, sku).

### 2.13 inventory_transactions
id PK · garage_id FK · part_id FK · supplier_id FK nullable · transaction_type enum PURCHASE/SALE/REPAIR_USAGE/RETURN/ADJUSTMENT/DAMAGE/TRANSFER · quantity_delta int NOT NULL (signed) · quantity_after int NOT NULL (post-state snapshot) · unit_cost int nullable · reference text (e.g. repair_job id) · performed_by FK→users · notes · created_at. Indexes: part_id, (garage_id, created_at). **Every stock change writes a row in the same DB transaction as the part update.**

### 2.14 part_usages (repair ↔ part)
id PK · repair_job_id FK · part_id FK · quantity int NOT NULL CHECK > 0 · unit_price_at_use int cents (snapshot) · created_at.

### 2.15 suppliers
id PK · garage_id FK · name NOT NULL · phone · email · address · tax_identifier (PIN) · notes · created_at/updated_at/deleted_at.

### 2.16 invoices
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| garage_id / booking_id / customer_id | FKs | booking_id nullable (walk-in) |
| invoice_number | text | UNIQUE `INV-2026-000456` |
| status | enum | DRAFT/ISSUED/PARTIALLY_PAID/PAID/VOID/REFUNDED |
| subtotal / discount / tax / total / amount_paid / balance_due | int cents | **always backend-computed**; CHECK total = subtotal − discount + tax |
| currency | text | default 'KES' |
| issued_at / due_at | timestamptz | |
| voided_at / voided_by / void_reason | | corrections via VOID, never delete |
| created_at / updated_at | | |

Indexes: customer_id, booking_id, status, invoice_number(unique).

### 2.17 invoice_items
id PK · invoice_id FK CASCADE · item_type enum SERVICE/PART/OTHER · description NOT NULL · quantity numeric(10,2) CHECK > 0 · unit_price int · discount int · tax int · total int (backend-computed) · service_id/part_id/repair_job_id FKs nullable · created_at. **Prices are snapshots at issue time.**

### 2.18 payments
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| garage_id / invoice_id / booking_id / customer_id | FKs | |
| amount | int cents | CHECK > 0 |
| currency | text | 'KES' |
| method | enum | MPESA/CASH/CARD/BANK_TRANSFER/OTHER |
| status | enum | PENDING/INITIATED/PROCESSING/COMPLETED/FAILED/CANCELLED/REVERSED/REFUNDED/UNKNOWN |
| provider | text | 'DARAJA' / 'MANUAL' |
| provider_transaction_id | text | Daraja CheckoutRequestID etc., indexed |
| mpesa_receipt | text | unique where present |
| phone_number | text | paying MSISDN |
| idempotency_key | text | UNIQUE NOT NULL (client or server generated) |
| initiated_at / completed_at / failed_at | timestamptz | |
| created_at / updated_at | | |

Corrections are new rows (REVERSAL/REFUND referencing original via `reverses_payment_id` self-FK) — **never overwrite a completed payment**.

### 2.19 payment_events
id PK · payment_id FK · provider text · event_type enum (STK_CALLBACK/TIMEOUT/RECONCILIATION/…) · external_event_id text · payload_hash text NOT NULL (sha256 of raw body — idempotency) · payload_metadata jsonb (sanitized; no credentials) · processed boolean · processed_at · created_at. UNIQUE (provider, external_event_id) + index on payload_hash → duplicate callbacks rejected cheaply (§62).

### 2.20 mpesa_requests (Daraja audit)
id PK · payment_id FK nullable · phone_number · amount · merchant_request_id · checkout_request_id · status enum SENT/ CALLBACK_RECEIVED / TIMEOUT / FAILED · result_code int nullable · result_desc · created_at. Never stores passkey/consumer secret.

### 2.21 refresh_sessions (token rotation + revocation)
id PK · user_id FK CASCADE · refresh_token_hash text NOT NULL (sha256 — raw token never stored) · device_label · ip inet · user_agent · expires_at NOT NULL · revoked_at nullable · rotated_from FK self nullable · created_at. Index (user_id), (refresh_token_hash). Rotation = insert new + revoke old in one transaction.

### 2.22 mfa_factors / mfa_challenges
factor: id · user_id FK · type enum TOTP · secret_encrypted text (AES-256-GCM, key from env) · confirmed_at · last_used_at · disabled_at. challenge: id · user_id FK · code_hash · purpose enum LOGIN · expires_at short TTL · consumed_at · attempts int.

### 2.23 login_attempts / security_events
login_attempt: id · phone_or_email · user_id nullable · success bool · ip · user_agent · created_at. (source for throttling)
security_events: id · garage_id nullable · user_id nullable · event_type enum FAILED_LOGIN/ACCOUNT_LOCKOUT/SUSPICIOUS_ACCESS/INVALID_TOKEN/RATE_LIMIT_EXCEEDED/UNAUTHORIZED_RESOURCE_ACCESS/MULTIPLE_FAILED_PAYMENT_ATTEMPTS · resource text · ip · user_agent · metadata jsonb · created_at. Index (event_type, created_at).

### 2.24 audit_logs
id PK · garage_id nullable · actor_id FK→users nullable · action text NOT NULL (LOGIN, LOGOUT, CREATE_BOOKING, CHANGE_BOOKING_STATUS, CREATE_DIAGNOSTIC, CREATE_INVOICE, PAYMENT_INITIATED, PAYMENT_COMPLETED, PAYMENT_REVERSED, REFUND, INVENTORY_ADJUSTMENT, USER_CREATED, ROLE_CHANGED, PASSWORD_CHANGED, …) · resource_type · resource_id uuid · request_id text · ip inet · user_agent · metadata jsonb (sanitized) · created_at. Index (actor_id, created_at), (resource_type, resource_id). Append-only (no update/delete grants).

### 2.25 notification_jobs / notification_logs
job: id PK · garage_id · channel enum SMS/WHATSAPP/EMAIL · recipient · template_key · payload jsonb · booking_id/invoice_id nullable · status enum QUEUED/PROCESSING/SENT/FAILED/RETRYING/CANCELLED · attempts int · next_retry_at · sent_at · last_error · idempotency_key UNIQUE · created_at/updated_at.
log: id · job_id FK · attempt_no · provider text · provider_message_id · status · error · created_at.

### 2.26 media_files
id PK · garage_id · uploaded_by FK→users · entity_type enum (BOOKING/DIAGNOSTIC/GALLERY/OTHER) · entity_id uuid nullable · storage_key text NOT NULL (S3 key, private bucket) · original_filename · mime_type · file_size bigint · checksum sha256 · visibility enum PUBLIC/PRIVATE · thumbnails jsonb (generated keys) · created_at. Index (entity_type, entity_id). Signed-URL issuance for PRIVATE; PUBLIC only for marketing media (M6).

### 2.27 testimonials
id PK · garage_id · author_name · author_area · vehicle · rating smallint CHECK 1–5 · quote text NOT NULL · is_approved bool default false · is_featured bool default false · display_order int · source enum GOOGLE/WALKIN/FORM/MANUAL · created_at/updated_at. Index (garage_id, is_approved).

### 2.28 gallery_items
id PK · garage_id · title · vehicle_label · tag enum ENGINE/BRAKES/SUSPENSION/DIAGNOSTICS/AC_COOLING/ELECTRICAL/OTHER · video_url text nullable (public marketing video) · media_file_id FK nullable · external_url text nullable (current Unsplash placeholders live here) · is_published bool · display_order · created_at/updated_at.

### 2.29 consents
id PK · user_id FK · consent_type enum SERVICE_COMMUNICATION/MARKETING_EMAIL/MARKETING_SMS/MARKETING_WHATSAPP · status enum GRANTED/WITHDRAWN · source text · policy_version text · created_at. Append-only history (§40). Index (user_id, consent_type).

### 2.30 rate_limit_counters (redis is primary; DB fallback)
id PK · bucket text · identifier text (ip/user) · window_start · count. UNIQUE (bucket, identifier, window_start).

### 2.31 contact_messages
id PK · garage_id · name · phone · message · status enum NEW/READ/REPLIED/CLOSED · created_at. *(Current form's "Describe the issue" + notes land here when no booking is intended; doubles as the spam-auditable trail.)*

---

## 3. Tenant isolation model

1. Staff JWT contains `garageId` (derived from user record at login — **never from request body**).
2. Every Prisma query for garage-owned tables includes `where: { garageId: user.garageId }` via a shared `scopedQuery` helper — enforced by ESLint rule review in CI.
3. Customer role: queries additionally scoped `customerId = user.id`.
4. Cross-garage IDs (booking from another garage) return **404** (not 403) to avoid existence leaks; 403 reserved for same-garage role failures.

## 4. Index summary (beyond uniques)

users(email, phone, garageId+role) · vehicles(registrationNumber, customerId) · bookings(customerId, vehicleId, status, scheduledDate) · booking_status_history(bookingId) · payments(invoiceId, status, providerTransactionId, idempotencyKey) · payment_events(provider+externalEventId, payloadHash) · inventory_transactions(partId, garageId+createdAt) · audit_logs(actorId+createdAt, resourceType+resourceId) · security_events(eventType+createdAt) · notification_jobs(status, nextRetryAt) · media_files(entityType+entityId).

## 5. Transactions (required boundaries)

| Operation | Transaction |
|---|---|
| Payment completion (callback) | payment update + payment_event insert + invoice.amountPaid/balanceDue/status update + audit log |
| Repair completion w/ parts | repair_job update + part_usages inserts + parts.quantity_on_hand decrements + inventory_transactions inserts + invoice_items inserts |
| Refresh-token rotation | revoke old session + insert new session |
| Inventory adjustment | parts update + inventory_transaction insert |
| Booking creation (guest) | user upsert-by-phone + customer_profile ensure + vehicle (nullable) + booking + status_history + audit |

## 6. Migrations & seed plan

- `prisma migrate dev` per phase; no manual SQL drift; raw CHECK constraints added via `ALTER TABLE` in migration SQL.
- Seed: 1 garage (MOTORA Kilimani, the exact data in `site.js`) + garage_hours (Mon–Fri 8–6, Sat 8–4) + the 8 service names from the current `<select>` (+3 extras) + 1 SUPER_ADMIN + demo staff (mechanic/advisor/cashier) + 1 demo customer w/ 2 vehicles + 1 testimonial per current mock entry (approved) + 6 gallery_items matching `works` + demo parts/suppliers. **No fake M-Pesa credentials** — sandbox vars read from env, seed skips payment data.
