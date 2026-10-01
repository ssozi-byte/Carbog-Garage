# MOTORA Backend

NestJS modular monolith for the MOTORA garage platform. Phase 1 (foundation) — see `../docs/architecture.md` for the full architecture and `../docs/` for the API contract and database design.

## Requirements

- Node.js 22+
- Docker (for Postgres 16 + Redis 7 + MinIO in dev)

## Setup

```bash
cd backend
cp .env.example .env      # then edit secrets (see below)
npm install
```

Generate real dev secrets:

```bash
openssl rand -hex 48   # → JWT_ACCESS_SECRET
openssl rand -hex 48   # → JWT_REFRESH_SECRET
```

## Start infrastructure

```bash
docker compose up -d postgres redis minio
```

## Start the API

```bash
npm run start:dev        # ts-node — dev server on :3000
# or
npm run build && npm start
```

> **Why ts-node, not tsx?** tsx (esbuild) does not emit decorator metadata,
> which silently breaks NestJS constructor DI (params arrive `undefined`).
> ts-node uses real TypeScript semantics. Always typecheck with `npm run build`.

## Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
open http://localhost:3000/docs        # Swagger UI
```

## Tests

```bash
npm test                # unit tests
npm run test:e2e        # Phase 1 smoke suite (no external services needed)
```

## Phase 2 — database (done)

```bash
npx prisma migrate dev               # apply migrations (per docs/database.md)
npx prisma db seed                   # idempotent: garage, services, staff, content
npm run seed                         # same, direct
```

Seed demo logins (password from `SEED_PASSWORD` env or `MotoraDemo#2026`):
`owner@motora.co.ke` (SUPER_ADMIN) · `advisor@motora.co.ke` · `mechanic@motora.co.ke` · `cashier@motora.co.ke` · `storekeeper@motora.co.ke` (INVENTORY_MANAGER) · `customer@motora.co.ke`

> Dev ports are remapped to avoid clashes with other local projects:
> Postgres **5433**, Redis **6380**, MinIO **9002/9003** (see docker-compose.yml).

## Phase 4 — guest booking endpoint (done)

`POST /api/v1/bookings/quote-request` — public, powers the contact form.

- **Validation:** zod body schema + KE phone normalization (`0712…`, `+254 712…`, `712…` → `+254712…`); service name resolved against the active catalog
- **Idempotency:** same-day duplicate submissions return the existing booking number
- **Persistence:** one transaction → user upsert + booking (`REQUESTED`) + status history; audit log written after commit
- **Numbers:** `MOT-YYYY-NNNNNN` from a Postgres sequence (race-free)
- **Rate limit:** 3 requests / 10 min / IP (`429` + `Retry-After`)

```bash
curl -X POST http://localhost:3000/api/v1/bookings/quote-request \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","phone":"0712345678","serviceName":"Vehicle Diagnostics"}'
```

## Phase 4b — staff transitions (done)

State machine per `docs/database.md §2.8` — any illegal move returns `409 INVALID_STATUS_TRANSITION` with the allowed list; terminal statuses are permanent.

| Endpoint | Effect |
|---|---|
| `GET /api/v1/bookings?status=&page=&limit=` | staff list (customer + status) |
| `GET /api/v1/bookings/:bookingNumber` | detail incl. full history |
| `GET /api/v1/bookings/status-machine` | machine-readable transition table |
| `POST /api/v1/bookings/:n/confirm` | REQUESTED → CONFIRMED + scheduled slot (YYYY-MM-DD, HH:MM) |
| `POST /api/v1/bookings/:n/check-in` | CONFIRMED → CHECKED_IN |
| `PATCH /api/v1/bookings/:n/status` | any legal transition `{status, reason?}` |
| `POST /api/v1/bookings/:n/cancel` | REQUESTED/CONFIRMED → CANCELLED, reason required |

All staff routes require JWT auth (`Authorization: Bearer …`) + RBAC — see Phase 3 below (reads: MECHANIC+, transitions: SERVICE_ADVISOR+). Every transition writes history + audit rows in one transaction.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"scheduledDate":"2026-10-02","scheduledTime":"10:30"}' \
  http://localhost:3000/api/v1/bookings/MOT-2026-000123/confirm
```

## Phase 3 — auth & RBAC (done)

JWT access tokens (15 min) + rotating refresh sessions (30 d, httpOnly cookie scoped to `/api/v1/auth`), Argon2id passwords (OWASP m=19454,t=2,p=1), login throttling, TOTP MFA and role-based access control. The interim `X-Staff-Key` guard is **removed**.

| Endpoint | Notes |
|---|---|
| `POST /api/v1/auth/register` | customer signup; passwordless guest accounts upgrade in place; seeded staff can claim credentials with `staffInviteCode` |
| `POST /api/v1/auth/login` | phone or email; `200 {mfaRequired:true}` when a TOTP factor is active, else `{user, accessToken, expiresIn}` + refresh cookie |
| `POST /api/v1/auth/refresh` | rotates the session (one tx); reuse of a rotated token revokes **all** of the user's sessions |
| `POST /api/v1/auth/logout` | revokes the presented session |
| `GET /api/v1/auth/sessions` · `DELETE /api/v1/auth/sessions/:id` | list / revoke own sessions |
| `POST /api/v1/auth/password` | change password (revokes other sessions) |
| `POST /api/v1/auth/mfa/enroll` · `verify` | ADMIN+ TOTP enrollment |

- **Throttling:** 5 failed logins / 15 min per IP+identifier → `RATE_LIMITED`; 5 consecutive failures on one account → `ACCOUNT_LOCKED` (423) for 15 min. Every attempt lands in `login_attempts`; failures also raise `security_events`.
- **RBAC:** `@Roles('SERVICE_ADVISOR+')` — rank order CUSTOMER < MECHANIC < SERVICE_ADVISOR/INVENTORY_MANAGER/CASHIER < ADMIN < SUPER_ADMIN. Booking staff routes: reads MECHANIC+, transitions SERVICE_ADVISOR+.
- **Audit:** status-history rows carry `changedByUserId`; audit logs carry `actorId` + `metadata.via: 'jwt'`.
- **MFA secrets** are AES-256-GCM encrypted at rest (`MFA_ENCRYPTION_KEY`, ≥32 chars, required before MFA use). TOTP is implemented directly on node:crypto (RFC 6238: SHA-1, 6 digits, 30 s, ±1 window) — Google Authenticator compatible, no runtime dep.
- **Env changes:** new `MFA_ENCRYPTION_KEY` and `STAFF_INVITE_CODE` (unset = staff claiming disabled); `STAFF_API_KEY` removed.

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phoneOrEmail":"advisor@motora.co.ke","password":"MotoraDemo#2026"}' \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/v1/bookings?limit=5"
```

## Phase 5A — work orders / job card (done)

The spine of the platform (docs/platform-roadmap-v2.md §2.1): checking a booking in **spawns its work order atomically** — the job card everything else will hang off (inspections, estimates, parts, QC, photos).

| Endpoint | Roles | Notes |
|---|---|---|
| `GET /api/v1/work-orders/board?board=workshop\|wash` | SERVICE_ADVISOR+ | live board, open orders by priority |
| `GET /api/v1/work-orders/my-today` | MECHANIC+ | the signed-in tech's open jobs + completed-today |
| `GET /api/v1/work-orders?status=&technicianId=&page=` | SERVICE_ADVISOR+ | paginated list |
| `GET /api/v1/work-orders/:woNumber` | MECHANIC+ | detail incl. status history |
| `PATCH /api/v1/work-orders/:woNumber/status` | MECHANIC+ | legal-move validated; mechanics only their own orders |
| `POST /api/v1/work-orders/:woNumber/assign` | SERVICE_ADVISOR+ | assign/reassign technician |
| `GET /api/v1/work-orders/status-machine` | MECHANIC+ | machine-readable transition table |

State machine adds `WAITING_PARTS` (loops to `IN_PROGRESS`), `TESTING` and `QUALITY_CHECK` before `READY_FOR_COLLECTION`. Service name → WO type mapping (diagnostics → DIAGNOSTIC, wash → WASH, …). History rows carry the JWT actor; illegal jumps → `409 INVALID_STATUS_TRANSITION` + allowed list; `WO-YYYY-NNNNNN` from its own Postgres sequence; one WO per booking (unique FK).

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"IN_PROGRESS"}' \
  http://localhost:3000/api/v1/work-orders/WO-2026-000012/status
```

## Phase 5B — inspections & media (done)

Digital vehicle inspection (DVI) engine: the mechanic taps through a seeded **33-item checklist across 8 sections** (Exterior, Tyres, Brakes, Engine, Electrical, Suspension, Interior, Diagnostics) — status + measurement + photo per point, no prose. Findings become customer-facing items the advisor reviews and sends; customers approve/decline/defer.

| Endpoint | Roles | Notes |
|---|---|---|
| `POST /api/v1/work-orders/:n/inspections` | MECHANIC+ | starts/resumes the run (template snapshot) |
| `GET /api/v1/inspections/:runId` | MECHANIC+ | fill-in view: sections + items + recorded results |
| `PUT /api/v1/inspections/:runId/results/:resultId` | MECHANIC+ | **idempotent upsert, client-generated UUID — offline outbox safe**; replay = no-op, re-record = last-write-wins |
| `POST /api/v1/inspections/:runId/submit` | MECHANIC+ | completeness gate (every item recorded), then locks the run |
| `POST /api/v1/inspections/:runId/findings` | MECHANIC+ | promote a result into a finding (severity auto-derived) |
| `PATCH /api/v1/findings/:id` | SERVICE_ADVISOR+ | review: customer title/explanation + visibility |
| `POST /api/v1/work-orders/:n/findings/send` | SERVICE_ADVISOR+ | PROPOSED+visible → SENT |
| `POST /api/v1/findings/:id/decision` | CUSTOMER(own)/SA+ | APPROVE / DECLINE(+reason) / DEFER(+followUpAt) |
| `GET /api/v1/work-orders/:n/findings` | MECHANIC+/CUSTOMER(own) | customers see only visible findings |
| `POST /api/v1/media/upload-url` → confirm / `GET :id/url` | MECHANIC+ | presigned S3/MinIO PUT (SigV4, no SDK), 25 MB cap, JPEG/PNG/WEBP/MP4; **503 STORAGE_NOT_CONFIGURED when S3_* unset** |

Security notes: result item IDs are validated against the run's template snapshot; runs lock on submit; customers can only see/decide their own job's findings (404 otherwise). Declined/deferred findings are never deleted — `followUpAt` feeds the reminders engine.

## Phase 5C — estimates & approvals (done)

The money conversation (docs/platform-roadmap-v2.md §4): the advisor prices the findings into a **one-estimate-per-work-order** quote (`EST-YYYY-NNNNNN` from its own sequence), sends it to a customer who may never have registered, and the guest approves or declines after an **OTP phone sign-in** — no passwords, fully audited. Every estimate action lands in an **append-only approval ledger**; nothing is ever edited or deleted.

| Endpoint | Roles | Notes |
|---|---|---|
| `POST /api/v1/work-orders/:n/estimates` | SERVICE_ADVISOR+ | build/rebuild the DRAFT from item lines; totals recomputed server-side |
| `GET /api/v1/work-orders/:n/estimate` | SERVICE_ADVISOR+ | staff view: items + approval ledger |
| `POST /api/v1/estimates/:n/send` | SERVICE_ADVISOR, INVENTORY_MANAGER, ADMIN, SUPER_ADMIN | DRAFT + ≥1 item → SENT; ledger row; walks the WO CHECKED_IN→INSPECTION→AWAITING_APPROVAL; **CASHIER may build but never sends** (invoices are 5E) |
| `POST /api/v1/estimates/:n/otp-request` | public (phone) | one-time code to the customer's phone; per-phone throttled |
| `POST /api/v1/estimates/:n/view` | public (OTP) | customer projection; first fetch records VIEWED once per send |
| `POST /api/v1/estimates/:n/approve` | public (OTP) | findings covered by the send → APPROVED; WO → APPROVED with CUSTOMER history rows |
| `POST /api/v1/estimates/:n/decline` | public (OTP) | reason `TOO_EXPENSIVE\|LATER\|NEED_INFO\|OTHER`; covered findings → DEFERRED + `followUpAt`; WO back to INSPECTION for re-estimation |
| `GET /api/v1/estimates/deferred` | SERVICE_ADVISOR+ | defer-tracking feed for the Phase 7 reminders engine |

**Money math** is integer-only: qty is thousandths (`qty_milli` — 0.5 h labour = 500), prices are KES cents, `line_total = round(qty_milli × unit_price_cents / 1000)`, VAT 16% (`VAT_RATE_MILLI = 160000`, divided by 1 000 000 — rate and cents both carry the ×1000). Totals are never trusted from the client.

**OTP phone sign-in** (`POST /api/v1/auth/otp/request` · `verify`): codes are sha256-hashed (`phone:code`), one PENDING code per phone+purpose (a new request expires the old), 5 wrong attempts → `MAXED_OUT`, per-phone throttle 3 requests/15 min → `429 OTP_RATE_LIMITED` (IP middleware backstop 10/10 min). Verify is one-shot and returns a 15-minute JWT `{sub:'otp:'+phone, scope:{estimateId}, purpose:'ESTIMATE_APPROVAL'}`. `devCode` is echoed only outside production; delivery is a `deliverCode()` seam for Phase 8 SMS.

**Customer routes take a dual credential:** a `Bearer` scope token from verify, or a one-shot `{phone, code}` body on the decision itself. Ownership is enforced server-side — wrong phone → `404`, wrong/consumed code → `401 OTP_INVALID` (the OTP gate fires before any estimate state check, so nothing leaks). Lapsed SENT estimates are stamped EXPIRED at read time and decisions are blocked with `409`; declines are recorded forever and feed `estimates/deferred`.

```bash
curl -X POST http://localhost:3000/api/v1/estimates/EST-2026-000048/otp-request \
  -H 'Content-Type: application/json' -d '{"phone":"+254711000111"}'   # devCode in the reply

curl -X POST http://localhost:3000/api/v1/estimates/EST-2026-000048/approve \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+254711000111","code":"123456"}'   # or: Bearer <scope token>
```

## Phase 5D — parts & inventory (done)

The storekeeper's world (docs/platform-roadmap-v2.md §4 "Parts"): a per-garage **catalog** (`parts`, SKU unique per garage, integer KES cents), an **append-only stock ledger** (`inventory_transactions` — signed delta + post-state snapshot, written in the SAME DB transaction as every stock change), and the mechanic's **parts_requests** loop whose issue step is the only code path that decrements stock.

| Endpoint | Roles | Notes |
|---|---|---|
| `POST /api/v1/parts` · `PATCH /parts/:id` | INVENTORY_MANAGER, ADMIN, SUPER_ADMIN | create (opening stock → PURCHASE ledger row) / metadata edit (never stock) |
| `GET /api/v1/parts?q=&lowStock=true&page=` | MECHANIC+ | catalog search; mechanics read parts (§6 matrix) |
| `GET /api/v1/parts/:id` | INVENTORY_MANAGER+ | part + its stock ledger (last 100 rows) |
| `POST /api/v1/parts/:id/adjust` | INVENTORY_MANAGER+ | PURCHASE / RETURN / ADJUSTMENT / DAMAGE / TRANSFER — always paired with a ledger row |
| `GET /api/v1/inventory/transactions?partId=` | INVENTORY_MANAGER+ | the append-only audit trail |
| `POST /api/v1/work-orders/:n/parts-requests` | MECHANIC+ (own jobs) | ask for N units; walks the WO → WAITING_PARTS via legal moves + history |
| `GET /api/v1/parts-requests?status=` · `/work-orders/:n/parts-requests` | queue: INVENTORY_MANAGER+ · per-WO: MECHANIC+ | the storekeeper queue |
| `POST /api/v1/parts-requests/:id/issue` | INVENTORY_MANAGER, ADMIN, SUPER_ADMIN | **stock −N + REPAIR_USAGE ledger row + request → ISSUED, one tx**; resumes WAITING_PARTS → IN_PROGRESS |
| `POST /api/v1/parts-requests/:id/order` | INVENTORY_MANAGER+ | nothing on the shelf → ORDERED (procurement), stock untouched |
| `POST /api/v1/parts-requests/:id/cancel` | MECHANIC+ | only while still REQUESTED |

Stock can never go negative: `parts.quantity_on_hand >= 0` is a SQL CHECK **and** a conditional `updateMany` guard inside the issuing transaction, so concurrent issues of the last unit resolve 409 `INSUFFICIENT_STOCK` with an untouched ledger. Roles are exact lists on stock writes — SA/CASHIER rank equal to INVENTORY_MANAGER in the RBAC ladder, so a `+` gate would let them through (cashier 403s on issue/adjust; a request decided twice → 409 `INVALID_PART_REQUEST_STATE`). Seed adds `storekeeper@motora.co.ke` (INVENTORY_MANAGER) + 3 demo parts.

```bash
curl -X POST http://localhost:3000/api/v1/work-orders/WO-2026-000249/parts-requests \
  -H "Authorization: Bearer $MECH" -H 'Content-Type: application/json' \
  -d '{"partId":"…","quantity":1,"note":"Left front, squealing"}'        # WO → WAITING_PARTS

curl -X POST http://localhost:3000/api/v1/parts-requests/:id/issue \
  -H "Authorization: Bearer $STORE"                                        # stock −1, ledger row, WO → IN_PROGRESS
```

## Phase 5E — quality gate, invoicing & payments (done)

The last workshop gate and the money path (docs/platform-roadmap-v2.md §4/§15, original Phase 6–7): the mechanic submits a fixed **8-point checklist** from TESTING (the submit itself walks the WO → QUALITY_CHECK), SERVICE_ADVISOR+ approves or rejects it, and only an **approved latest check opens the READY_FOR_COLLECTION gate** — enforced inside the work-order state machine, not by convention. From there the cashier composes the invoice from the APPROVED estimate verbatim plus issued-parts snapshots, issues it, and takes payments: counter methods complete in-transaction, MPESA raises a Daraja STK push whose public callback completes (or fails) the payment.

| Endpoint | Roles | Notes |
|---|---|---|
| `POST /api/v1/work-orders/:n/submit-qc` | MECHANIC, ADMIN, SUPER_ADMIN (exact lists) | 8 booleans; WO → QUALITY_CHECK with history; incomplete submission allowed but flagged (review will reject) |
| `GET /api/v1/quality-checks` · `/:id` | SERVICE_ADVISOR+ | review queue (undecided) + detail |
| `POST /api/v1/quality-checks/:id/approve` | SERVICE_ADVISOR+ | `{}` approves, `{rejectedReason:"…"}` rejects; approving an undecided-incomplete check → 409 `QC_INCOMPLETE`; re-deciding → 409 `QC_ALREADY_DECIDED` |
| `GET /api/v1/work-orders/:n/qc-gate` | MECHANIC+ | `{gateRequired, gateOpen, latest}` — the same shape any future washer/collection UI reads |
| `POST /api/v1/work-orders/:n/invoice` | CASHIER+ | compose (recompose only while DRAFT): APPROVED estimate lines verbatim + issued parts at `unitPriceAtIssueCents`, **deduped per estimate part line**; discount budget absorbed down lines, VAT on the discounted subtotal |
| `POST /api/v1/invoices/:n/issue` · `/void` | CASHIER+ | issue freezes totals; void needs a reason and is blocked once `amount_paid_cents > 0` |
| `GET /api/v1/invoices` · `/:n` · `/work-orders/:n/invoice` | CASHIER+ | list/filter, detail, per-WO lookup |
| `POST /api/v1/invoices/:n/payments` | CASHIER+ | CASH/CARD/BANK_TRANSFER/OTHER complete in-tx (`PARTIALLY_PAID → PAID`); MPESA → PENDING + `mpesa_requests` + STK push; overpay → 409 `AMOUNT_EXCEEDS_BALANCE`; client `idempotencyKey` replays return the same payment |
| `POST /api/v1/payments/:id/reverse` | CASHIER+ | corrections are new rows: a REVERSED payment with `reverses_payment_id`, invoice balance recomputed; double-reverse guarded |
| `POST /api/v1/payments/mpesa/callback` | public | Daraja STK callback: sha256 payload hash + `UNIQUE (provider, external_event_id)` — replays answer `{duplicated:true}` without double credit; `ResultCode 0` → COMPLETED + receipt + invoice credit, anything else FAILED; **event rows are always recorded**, matched or not |

Money is integer KES cents end to end (`src/common/money.ts`: `lineTotal` qty-milli × cents, `vatOn` at VAT_RATE_MILLI 160,000‰); invoice items snapshot the price they were billed at. The QC gate is a hard `409 QC_NOT_APPROVED` in `WorkOrdersService.transition` (WASH exempt — that flow ships in Phase 6). M-Pesa is **fail-closed**: without `MPESA_*` env the STK push answers `503 PAYMENT_PROVIDER_NOT_CONFIGURED` while CASH and the callback simulator keep working, so CI needs no Safaricom credentials; the passkey never leaves the signing function and is never persisted (`mpesa_requests` stores only request ids/status).

```bash
curl -X POST http://localhost:3000/api/v1/work-orders/WO-2026-000542/submit-qc \
  -H "Authorization: Bearer $MECH" -H 'Content-Type: application/json' \
  -d '{"repairCompleted":true,"partsInstalled":true,"noLeaks":true,"warningLights":true,"testDrive":true,"toolsRemoved":true,"vehicleCleaned":true,"belongingsChecked":true}'

curl -X POST http://localhost:3000/api/v1/quality-checks/:qcId/approve \
  -H "Authorization: Bearer $ADVISOR" -d '{}'                             # gate opens

curl -X POST http://localhost:3000/api/v1/work-orders/WO-2026-000542/invoice \
  -H "Authorization: Bearer $CASHIER" -d '{}'                             # DRAFT compose → issue

curl -X POST http://localhost:3000/api/v1/invoices/INV-2026-000094/payments \
  -H "Authorization: Bearer $CASHIER" -H 'Content-Type: application/json' \
  -d '{"method":"CASH","amountCents":846800}'                            # PAID, balance 0
```

## Phase 6 — car wash (done)

§2.2 made real: a wash is a work order with `type=WASH` plus ONE `wash_jobs` row (package = the WASH-category service, current step, jsonb `step_history`), spawned atomically inside the check-in transaction. The washer's five-button UI is `POST /api/v1/wash-jobs/:woNumber/step` — each press advances `QUEUED → WASHING → VACUUMING → DETAILING → QUALITY_CHECK → READY` (forward skips legal, packages differ), appends the audit trail, and walks the underlying WO (CHECKED_IN → IN_PROGRESS → QUALITY_CHECK → READY_FOR_COLLECTION) so washes and brake jobs share one vehicle timeline.

| Endpoint | Roles | Notes |
|---|---|---|
| `GET /api/v1/wash-jobs` | MECHANIC+ | the wash-bay board: open jobs, live step, package, washer, waiting time |
| `GET /api/v1/wash-jobs/my-today` | WASHER+ | the signed-in washer's open jobs |
| `GET /api/v1/wash-jobs/:woNumber` | MECHANIC+ | detail + step history + `allowedNextSteps` |
| `POST /api/v1/wash-jobs/:woNumber/assign` | SERVICE_ADVISOR+ (washer self-claim) | sets washer + WO technician; 404 cross-garage, no leak |
| `POST /api/v1/wash-jobs/:woNumber/step` | WASHER/MECHANIC (own jobs) · SA+ any | the five-button press: 409 `INVALID_WASH_STEP_TRANSITION` + allowed list; `WASH_ALREADY_READY` on the terminal; **`X-Event-Id` (client UUID) makes offline replays a no-op** — the same id returns the same state, no double history |
| `PATCH /api/v1/work-orders/:n/status` | SA+ | the two machines never bleed: a WASH WO answers `409 NOT_A_WASH_JOB` except CANCELLED/COMPLETED close-outs |

The `WASHER` role joins `UserRole` and `ROLE_RANK` at MECHANIC rank (rank 2), so every existing `MECHANIC+` gate admits washers without touching those routes. Seed adds `washer@motora.co.ke` and three WASH packages (Exterior Wash 500, Wash & Vacuum 800, Full Detail Wash 1,500 KES) — booking one spawns the wash automatically at check-in.

```bash
curl -X POST http://localhost:3000/api/v1/wash-jobs/WO-2026-000745/step \
  -H "Authorization: Bearer $WASHER" -H 'Content-Type: application/json' \
  -H "X-Event-Id: $(uuidgen)" \
  -d '{"step":"WASHING"}'                                                 # offline-safe per press

curl -X PATCH http://localhost:3000/api/v1/work-orders/WO-2026-000745/status \
  -H "Authorization: Bearer $ADVISOR" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}'                                             # collection done → close out
```

## Deploy

See `../docs/architecture.md` §8–9 and the root `README.md`. The Dockerfile is multi-stage, runs as non-root, and ships a healthcheck.
