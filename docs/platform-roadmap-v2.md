# MOTORA Platform Roadmap v2 — Vehicle-Care Operating Platform

> **Status: PROPOSED.** This document reframes MOTORA from "garage website + booking system" into a vehicle-care operating platform. It supersedes the *phase numbering* in `docs/database.md` and `docs/api-contract.md` where they conflict; everything already shipped (Phases 1–4b and Phase 3 auth) is unchanged and remains the foundation.
>
> **Core reframing:** MOTORA is a **digital vehicle job-card and service-history system**.
> - Website = the **acquisition window** (booking, vehicle registration)
> - Customer app = the **customer window** into the job card
> - Mechanic/washer app = the **work window**
> - Manager dashboard = the **control window**
>
> Four interfaces, one NestJS backend, one PostgreSQL database, one job record per vehicle visit.

---

## 0. What already exists (do not rebuild)

| Shipped | Notes |
|---|---|
| Marketing website (React/Vite) | Dark luxury theme, live content from Phase 2 endpoints |
| DB core | garages, users, vehicles, services, bookings, booking_status_history, audit_logs |
| Public content API | TTL cache + rate limits, drives today's site |
| Guest quote-request | `POST /bookings/quote-request` — MOT-YYYY-NNNNNN, idempotent, transactional |
| Booking state machine | `booking-state-machine.ts` — `TRANSITIONS`, `assertTransition`, terminal statuses |
| **Phase 3 auth** | JWT access (15 min) + rotating refresh sessions w/ reuse detection, Argon2id, login throttling + lockout, TOTP MFA (ADMIN+), `@Roles()` rank RBAC, audit rows carry real `actorId` |
| E2E harness | 5 suites, 58 tests, rerun-safe |

Everything below **extends** this: same error envelope, same `X-Request-Id` context, same multi-tenant `garageId` scoping, same RBAC pattern, same audit discipline.

---

## 1. The ecosystem

```text
                      MOTORA BACKEND  (NestJS + PostgreSQL)
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   Main Website       Mobile App          Admin Dashboard
   (exists today)     (one codebase,      (web, manager/admin)
        │              role-based UI)           │
   booking,        CUSTOMER · MECHANIC        operations, reports,
   vehicle reg,    WASHER · SERVICE ADVISOR   inventory, staff, comms
   contact             │                       │
        └──────────────┴───────────────────────┘
                            │
                  SAME DATABASE · SAME JOB RECORD
```

**One mobile codebase with role-based screens** (not separate customer/mechanic apps) — cheaper to build, deploy, and keep consistent. The API enforces what each role sees; the mobile shell renders accordingly.

---

## 2. Design decisions (the four that shape everything)

### 2.1 Work orders are the spine; bookings stay the acquisition record

The existing `bookings` table captures *intent* (someone wants service). It must keep working exactly as today for the live website. At **check-in**, the booking spawns a **work order** — the job card — which owns everything from condition record to invoice.

```text
Booking (intent)  ──check-in──▶  Work Order (execution)  ──▶  Invoice
MOT-2026-000123                  WO-2026-000456
```

- Booking keeps its existing state machine (REQUESTED → CONFIRMED → CHECKED_IN …) unchanged for backward compatibility.
- The work order carries its own, richer machine (below). `CHECKED_IN` on the booking triggers work-order creation — one transaction, audited.
- **Everything in the ecosystem hangs off `work_orders.id`**: inspections, findings, estimates, parts, time logs, photos, QC, updates, invoice.

### 2.2 Car wash is not a separate system

A wash is a **work order with `type = WASH`** plus one lightweight `wash_jobs` row (package + current step + washer). The washer's five-button UI (`[START] [WASH COMPLETE] [VACUUM COMPLETE] [DETAILING COMPLETE] [QC] [READY]`) comes free from a wash-specific step machine modeled exactly like `booking-state-machine.ts`. One vehicle, one history — a wash and a brake job appear on the same vehicle timeline.

### 2.3 Results vs findings (this split powers estimates, approvals, declines)

- **Inspection result** = what the mechanic physically records per checklist item: `status (GOOD/WATCH/NEEDS_ATTENTION/CRITICAL) + measurement + photo + short note`. Typed in seconds, no prose.
- **Inspection finding** = the customer-facing item *derived/promoted* from a result by the service advisor or manager: friendly title, explanation, recommendation, and optionally linked estimate lines.

This is what makes each of these clean instead of tangled:
- Manager review gate (mechanic records facts; advisor decides what the customer sees — §9 of the vision)
- Estimate generation from findings
- **Decline/defer tracking**: a declined finding is never deleted — it stays with `DEFERRED` status + follow-up date and feeds reminders
- Customer-visible filtering (`customerVisible` flag per finding)

### 2.4 Offline-ready API contract from day one

Mechanics work in poor-connectivity workshops (§31). We will not build sync now, but the API is shaped for it:
- `inspection_results`, `work_order_time_logs`, `parts_requests`, `wash_jobs` step updates accept **client-generated UUIDs** as primary keys
- All mechanic-side writes are **idempotent upserts** (`PUT /inspections/:runId/results/:itemId`) — replaying the same payload is a no-op, so a mobile outbox can retry blindly
- Server validates that submitted item IDs belong to the run; conflicts resolve last-write-wins per item

---

## 3. Work-order state machine

Extends the existing booking statuses (same vocabulary, two new states):

```text
PENDING → CHECKED_IN → INSPECTION → AWAITING_APPROVAL → APPROVED
        → IN_PROGRESS → WAITING_PARTS → IN_PROGRESS
        → TESTING → QUALITY_CHECK → READY_FOR_COLLECTION → COMPLETED
                                  ↘ CANCELLED / NO_SHOW (pre-terminal only)
```

Rules carried over from the booking machine: every change → `work_order_status_history` (actor: CUSTOMER/STAFF/SYSTEM + `changedByUserId` from the JWT) + audit row; terminal statuses are permanent; illegal jumps → `409 INVALID_STATUS_TRANSITION` with the allowed list.

**Wash steps** (work orders with `type=WASH`, enforced by a separate table so the two machines never bleed into each other):

```text
QUEUED → WASHING → VACUUMING → DETAILING → QUALITY_CHECK → READY
```

---

## 4. Schema delta (v2 additions)

Grouped by purpose. `garageId` on everything tenant-scoped; money = integer KES cents.

**Work order core**
- `work_orders` — the job card. bookingId, vehicleId, customerId, type (REPAIR | SERVICE | DIAGNOSTIC | WASH | DETAILING | INSPECTION_ONLY), status, priority (LOW/NORMAL/HIGH/URGENT), complaint (customer's **original words**), diagnosis (mechanic's summary), assignedTechnicianId, bayLabel, mileageIn, startedAt, completedAt
- `work_order_status_history` — mirrors booking_status_history + `changedByUserId`
- `work_order_time_logs` — technicianId, startedAt, endedAt (client UUID, offline-friendly)
- `work_order_tasks` — pre-defined task lists per service (e.g. "Remove old pads", "Clean assembly", "Install new pads" → checkboxes), optional custom rows

**Check-in & condition (§27.2)**
- `vehicle_checkins` — workOrderId, mileage, fuelLevel (enum E/F/3-4/1-2), notes, keysReceived, customerBelongings, checkedInById
- Condition photos via `media_files` (tagged `CHECKIN_*`)

**Inspections**
- `inspection_templates` — seeded default template (~30 items across the 8 categories A–H of the vision); versioned, per-garage
- `inspection_sections` — Exterior, Tyres, Brakes, Engine, Electrical, Suspension, Interior, Diagnostics
- `inspection_items` — definition rows: label, section, expectedUnits (mm/PSI/V/%/—), allowPhoto
- `inspection_runs` — one per work order inspection attempt; templateVersion snapshot
- `inspection_results` — runId + itemId (**client UUID**), status, measurement (numeric + unit string), photoMediaId, note; idempotent upsert target
- `inspection_findings` — resultId?, title, severity (OK/WATCH/ATTENTION/CRITICAL), customerTitle, customerExplanation, customerVisible, status (OPEN → PROPOSED → SENT → APPROVED / DECLINED / DEFERRED), followUpAt (defer reminder), workOrderId

**Estimates & approvals (§11, §27.4)**
- `estimates` — workOrderId, status (DRAFT → SENT → APPROVED/DECLINED/EXPIRED), totals computed server-side
- `estimate_items` — kind (PART/LABOUR), partId?, description, qty, unitPrice, findingId? (traceability)
- `estimate_approvals` — **append-only**: action (SENT/VIEWED/APPROVED/DECLINED/REVISED/RE_APPROVED), actorId, actorType (CUSTOMER/STAFF), reason (decline reason enum: TOO_EXPENSIVE/LATER/NEED_INFO/OTHER + note). Never overwritten — the full approval history is permanent record.

**Parts (§13)**
- `parts`, `inventory_transactions` — as per original Phase 5 plan (unchanged)
- `parts_requests` — workOrderId, partId, qty, status (REQUESTED → ISSUED / ORDERED / CANCELLED), requestedById, decidedById; **issuing creates the inventory transaction + attaches the part to the work order in one tx**

**Quality control (§15)**
- `quality_checks` — workOrderId, checklist (fixed booleans: repair completed, parts installed, no leaks, warning lights, test drive, tools removed, vehicle cleaned, belongings checked), notes, checkedById, approved (gate before READY_FOR_COLLECTION for REPAIR/SERVICE types)

**Wash**
- `wash_jobs` — workOrderId (unique), package (serviceId, category=WASH), washerId, currentStep, stepHistory (jsonb audit trail of step transitions w/ timestamps + actor)

**Comms (§16–18)**
- `customer_updates` — manager-created broadcasts: audience (ALL_CUSTOMERS/SPECIFIC_CUSTOMER/SPECIFIC_VEHICLE/SPECIFIC_JOB/ALL_STAFF/MECHANICS/WASHERS), title, body, attachmentMediaId, sentById
- `notifications` — auto-generated from state events; `notification_logs` — per-channel delivery attempts (PUSH/SMS/WHATSAPP) with provider refs (Phase 8 BullMQ wiring unchanged)

**Lifecycle extras**
- `service_reminders` — vehicleId, dueMileage?, dueDate?, kind, status
- `media_files` — pulled **forward** from old Phase 9: photos are core to DVI, not a later nice-to-have. Presigned PUT to MinIO (dev) / S3, magic-byte check, ≤25 MB
- `diagnostic_reports` / `diagnostic_findings` — kept from original spec; the OBD/error-code side. A diagnostic finding can be promoted to a customer finding exactly like an inspection result.

**Tables from the vision doc we deliberately do NOT create** (and why):
- `car_wash_jobs/steps/assignments` family → `wash_jobs` single row (§2.2)
- `repair_jobs` (old spec) → merged into `work_orders` (two "job" tables = two sources of truth)
- `work_order_items` → `estimate_items` covers priced items
- `service_history` → derived view over completed work orders + payments (no duplicate write path)
- `customer_vehicles` → `vehicles` already exists

---

## 5. The central workflow → API map

| # | Step | Endpoint | Role | Effect |
|---|---|---|---|---|
| 1 | Booking | existing quote-request / `POST /bookings` | guest / CUSTOMER | unchanged |
| 2 | Check-in | `POST /bookings/:n/check-in` | SERVICE_ADVISOR+ | booking → CHECKED_IN **and** creates work order (1 tx) |
| 3 | Condition record | `PUT /work-orders/:id/checkin` | SERVICE_ADVISOR+ | mileage, fuel, notes, keys |
| 4 | Start inspection | `POST /work-orders/:id/inspections` | MECHANIC+ | creates run from current template |
| 5 | Record results | `PUT /inspections/:run/results/:itemId` | MECHANIC+ | idempotent upsert, offline-safe |
| 6 | Promote findings | `POST /inspections/:run/findings` | MECHANIC+ | from a result (or standalone) |
| 7 | Manager review | `PATCH /findings/:id` | SERVICE_ADVISOR+ | customerTitle/visible/explanation |
| 8 | Build estimate | `POST /work-orders/:id/estimates` | CASHIER+ (per original) or SERVICE_ADVISOR+ | items from findings |
| 9 | Send | `POST /estimates/:id/send` | SERVICE_ADVISOR+ | status SENT + approval row + notification |
| 10 | Customer approval | `POST /estimates/:id/approve` / `decline` | CUSTOMER (own) | append-only approvals; decline → findings DEFERRED + followUpAt |
| 11 | Start work | `POST /work-orders/:id/start` | MECHANIC (assigned) | IN_PROGRESS + time log open |
| 12 | Part request | `POST /work-orders/:id/parts-requests` | MECHANIC | → WAITING_PARTS until issued |
| 13 | Issue part | `POST /parts-requests/:id/issue` | INVENTORY_MANAGER+ | stock −1, tx row, work order +part |
| 14 | Record work | `PUT /work-orders/:id/tasks/:taskId` · time logs · photos | MECHANIC | checkboxes, hours, before/during/after |
| 15 | Finish → QC | `POST /work-orders/:id/submit-qc` → `POST /quality-checks/:id/approve` | MECHANIC → SERVICE_ADVISOR+ | TESTING → QUALITY_CHECK → (approval gate) |
| 16 | Invoice | existing Phase 6 plan (from work order) | CASHIER+ | totals from approved estimate + issued parts + logged time |
| 17 | Ready & release | `POST /work-orders/:id/ready` → `:id/release` | SERVICE_ADVISOR+ | READY_FOR_COLLECTION → COMPLETED |
| 18 | History & reminders | `GET /vehicles/:id/timeline` · reminders | scoped by role | vehicle passport data |

Read side (the four windows):
- Mechanic **Today**: `GET /work-orders/my-today` (assigned, grouped by status)
- Manager board: `GET /work-orders/board?type=WORKSHOP|WASH` (cards by status, incl. "waiting N minutes")
- Customer app: `GET /bookings/mine`, `GET /work-orders/:id` (customer-visible projection only), `GET /vehicles/mine`, `GET /vehicles/:id/timeline`
- Notifications: `GET /notifications/mine`

---

## 6. Roles & privacy (ODPC-aligned)

Capability matrix (enforced by `@Roles()` + object-level checks; cross-tenant → 404, existing pattern):

| Data | CUSTOMER | MECHANIC/WASHER | SERVICE_ADVISOR | INVENTORY_MANAGER | CASHIER | ADMIN+ |
|---|---|---|---|---|---|---|
| Own vehicles/jobs/invoices | ✔ | — | — | — | — | — |
| Assigned work orders (+ vehicle info needed) | — | ✔ | ✔ | — | — | ✔ |
| All garage work orders | — | — | ✔ | ✔ | ✔ | ✔ |
| Customers list/detail | — | — | ✔ | — | ✔ | ✔ |
| Findings (customer-visible) | own | ✔ (their runs) | ✔ | — | — | ✔ |
| Financials (estimates beyond own, invoices, payments) | own | ✗ | ✔ | ✗ | ✔ | ✔ |
| Inventory | — | read parts | read | ✔ | read | ✔ |
| Reports/dashboard | — | ✗ | bookings report | inventory report | payments read | ✔ |

Data-minimization notes baked into the API contract: mechanic projections exclude customer contact details beyond name/vehicle; customer projections exclude internal notes, costs of declined work, staff performance data; QR code (vehicle passport) resolves **only** to an authenticated view or a deliberately limited public verification page (plate + garage + "history exists") — never PII.

---

## 7. Offline sync (Phase 10, but the contract is ready now)

- Client stores writes in an outbox with client UUIDs; replays on reconnect (`✓ Synced` / `● Saved locally` / `↑ Syncing…`)
- Server-side: idempotent upserts + `If-Match`-free last-write-wins per result row; run status transitions stay server-authoritative
- Photo uploads: presigned PUT retried independently of metadata writes

---

## 8. Notification defaults (§32, §17)

| Event | Push | SMS | WhatsApp |
|---|---|---|---|
| Booking confirmed | ✔ | ✔ | opt-in |
| Checked in | ✔ | — | — |
| Inspection completed | ✔ | — | — |
| Estimate ready | ✔ | ✔ | opt-in |
| Approved / declined (to staff) | ✔ | — | — |
| Work started / completed | ✔ | — | — |
| Ready for collection | ✔ | ✔ | ✔ |
| Payment receipt | ✔ | — | ✔ |
| Manager updates (§16) | ✔ | — | — |
| Service reminder | ✔ | ✔ | opt-in |

Manager-created `customer_updates` ride the same delivery pipeline as automatic events — one writer, two triggers.

---

## 9. Delivery phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **5A — Work-order core** ✅ SHIPPED | schema + migration; check-in creates WO; WO state machine + history + audit; board & my-today endpoints; e2e for machine + RBAC (71 tests green across 6 suites) | manager can check in a booking and see the WO on the board; mechanic sees assigned jobs |
| **5B — Inspections** ✅ SHIPPED | templates seeded (33 items, 8 sections); runs, offline-safe result upserts, findings promotion; media_files + presigned uploads (SigV4, no SDK); e2e incl. idempotent replay (81 tests green across 7 suites) | mechanic completes a DVI in ≤1 min of taps; photos attach; findings list ready for review |
| **5C — Estimates & approvals** ✅ SHIPPED | estimates/items linked to findings (integer money, server-computed totals, EST- sequence); send (SERVICE_ADVISOR+ exact roles — cashier builds, never sends) walking the WO to AWAITING_APPROVAL; OTP phone sign-in for guests (hashed codes, throttles, one-shot 15-min scope token); append-only approval ledger incl. VIEWED; read-time expiry; decline → findings DEFERRED + followUpAt + deferred feed; e2e incl. OTP defenses & throttle (89 tests green across 8 suites) | full loop: findings → estimate → approve → WO APPROVED; decline recorded, never deleted |
| **5D — Parts** ✅ SHIPPED | parts catalog (garage-unique SKU, integer cents) + append-only inventory_transactions ledger written in the same tx as every stock change; parts_requests loop (mechanic → WAITING_PARTS walk → storekeeper issue: stock −N + REPAIR_USAGE row, one tx, race-free ≥0 guard; ORDERED/CANCELLED branches); exact-role stock writes (cashier 403); seed storekeeper + demo parts; e2e incl. ledger reconciliation & exhaustion (94 tests green across 9 suites) | mechanic request → storekeeper issue → stock decrement audited |
| **5E — QC + invoicing + payments** ✅ SHIPPED | quality_checks (fixed 8-point checklist, exact-role submit) gating READY_FOR_COLLECTION inside the WO state machine (WASH exempt, 409 QC_NOT_APPROVED); invoices composed from the APPROVED estimate + issued-parts snapshots (per-part dedupe, discount budget down lines, integer cents, INV- sequence) with issue/void guards; payments — counter methods complete in-tx, MPESA Daraja STK fail-closed without env, public callback with payload-hash + unique-event replay guard and always-recorded payment_events, reversals as new REVERSED rows, idempotency keys; seed cashier; e2e incl. gate blocking, callback loop (success/replay/failure/unknown) & reversal (102 tests green across 11 suites) | READY_FOR_COLLECTION impossible without QC approval; invoice ↔ payment ledger correct |
| **6 — Car wash** ✅ SHIPPED | a wash = type=WASH work order + ONE wash_jobs row spawned atomically at check-in (package = WASH-category service, 3 seeded packages + washer seed login); separate step machine QUEUED → WASHING → VACUUMING → DETAILING → QUALITY_CHECK → READY (forward skips legal, QUALITY_CHECK → WASHING recovery edge) with jsonb step_history; washer five-button UI = POST /wash-jobs/:n/step with X-Event-Id client-UUID idempotency for offline replays; WO walks in parallel (CHECKED_IN → IN_PROGRESS → QUALITY_CHECK → READY_FOR_COLLECTION) so washes share the vehicle timeline; workshop PATCH walled off (409 NOT_A_WASH_JOB except CANCELLED/COMPLETED close-outs); WASHER role at MECHANIC rank; e2e incl. spawn, full walk, machine-separation walls, replay idempotency, RBAC (106 tests green across 12 suites) | washer completes a wash in taps only; wash appears on vehicle timeline |
| **7 — Comms & reminders** | notifications (auto), customer_updates (manual), service_reminders, channels matrix | every state event produces the right notification; manager can broadcast |
| **8 — Apps & dashboard** | mobile shell (role-based) + admin dashboard on the same API | all four windows live against one backend |
| **9 — Vehicle passport** | timeline views (customer vs staff projections), QR → authenticated/limited view | QR leaks no PII; timeline shows washes + repairs + costs per role |
| **10 — Reports, staff, offline sync** | dashboards, staff operational stats (objective: assigned/completed/time/comebacks), outbox sync | mechanic works offline; sync reconciles; no data loss |

Ordering notes: 5A–5E unblock everything and reuse the auth/RBAC/audit backbone as-is; the mobile app comes **after** the API it consumes is stable (8), but wash (6) lands before apps so the washer UI ships with the first mobile build. Invoicing/payments stay in the original phase's substance — only renumbered.

---

## 10. Open decisions before 5A starts

1. **Customer identity for approvals** — estimates are sent to guests who may never have registered. Proposal: phone-number-first identity; sending an estimate to a phone without an account triggers OTP-based sign-in (no forced passwords). Keeps the approval loop frictionless while staying auditable.
2. **Who prices estimates** — vision says manager; original spec says CASHIER+. Proposal: SERVICE_ADVISOR+ builds/sends; CASHIER+ issues invoices (creation ≠ money).
3. **QC approver** — SERVICE_ADVISOR+ can QC except on their own jobs? (simple version: any SERVICE_ADVISOR+, strict version excludes self-approval). Recommend strict for REPAIR, lenient for WASH.
4. **Template custody** — global seed template copied per garage at first use (allows per-garage edits without breaking others). Recommend yes.
