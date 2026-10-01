# MOTORA — API Contract (v1)

> Base path: `/api/v1` · Swagger UI at `/docs` (OpenAPI 3, served by NestJS).
> Response envelope everywhere (Spec §31):
>
> ```json
> { "success": true, "data": {}, "meta": { "page": 1, "limit": 20, "total": 42 } }
> { "success": false, "error": { "code": "BOOKING_NOT_FOUND", "message": "…", "requestId": "…" } }
> ```
>
> Pagination default `page=1&limit=20`, max `limit=100` (§41). Auth: `Authorization: Bearer <access>` (15 min) + rotating refresh session. Errors are stable string codes; messages safe; `requestId` correlates with logs.

**Frontend contract of behavior:** endpoints marked **[USED BY CURRENT UI]** are sufficient to run today's MOTORA frontend with live data (plus the small M2 swap of hardcoded `<select>` options to `GET /services`). Everything else serves Phases 5–10 and the future portal/admin UI.

---

## 1. Auth (Phase 3)

| Method | URL | Auth | Roles | Body / Params | Success | Errors |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | — | public | `{ firstName, lastName, phone(+254…), email?, password }` — zod: phone E.164-KE, pw ≥10 chars w/ letter+number | 201 `{ user, expiresIn }` + set refresh cookie | PHONE_TAKEN, EMAIL_TAKEN, WEAK_PASSWORD, VALIDATION_ERROR, RATE_LIMITED |
| POST | `/auth/login` | — | public | `{ phoneOrEmail, password, mfaCode? }` | 200 `{ user, mfaRequired?, accessToken }` + refresh cookie | INVALID_CREDENTIALS, ACCOUNT_LOCKED, MFA_REQUIRED, MFA_INVALID, RATE_LIMITED |
| POST | `/auth/refresh` | refresh cookie (httpOnly, SameSite=Lax, Secure prod) | any | — (rotates: revoke+reissue in 1 tx) | 200 `{ accessToken }` | INVALID_TOKEN, TOKEN_REVOKED |
| POST | `/auth/logout` | access | any | — | 200 (revokes current session) | UNAUTHORIZED |
| GET | `/auth/sessions` | access | any | — | 200 `{ sessions[] }` | UNAUTHORIZED |
| DELETE | `/auth/sessions/:id` | access | any (own) | — | 200 | UNAUTHORIZED, FORBIDDEN |
| POST | `/auth/password` | access | any | `{ currentPassword, newPassword }` | 200 | INVALID_CREDENTIALS, WEAK_PASSWORD |
| POST | `/auth/mfa/enroll` · `/auth/mfa/verify` | access | ADMIN+ | TOTP enroll/confirm | 200 `{ otpauthUrl, secret }` / 200 | MFA_ALREADY_ENROLLED, MFA_INVALID |

Throttling: login 5/15min per IP+identifier (lockout escalates), register 3/h/IP, refresh 30/min/user. All attempts → `login_attempts`; failures → `security_events`.

## 2. Public content (Phase 2 — read-only, cached 60s, no auth)

| Method | URL | Auth | Roles | Query | Returns (fields) | Errors |
|---|---|---|---|---|---|---|
| GET | `/garages/public/current` **[USED BY CURRENT UI]** | — | public | — | name, slug, phone, whatsappNumber, email, address, city, area?, county, lat/lng, hours[7], brandsServiced[], stats{}, socials, directionsUrl | NOT_FOUND |
| GET | `/services` **[USED BY CURRENT UI]** | — | public | `active=true`, `category=CORE|EXTRA`, page/limit | id, name, slug, description, iconKey, displayNum, points[], basePrice?, estimatedDurationMinutes, isActive | VALIDATION_ERROR |
| GET | `/testimonials` **[USED BY CURRENT UI]** | — | public | `approved=true`, `featured`, page/limit | id, authorName, authorArea, vehicle, rating, quote | — |
| GET | `/gallery-items` **[USED BY CURRENT UI]** | — | public | `tag=ENGINE|…`, page/limit | id, title, vehicleLabel, tag, imageUrl | — |
| POST | `/contact-messages` **[USED BY CURRENT UI]** | — | public | `{ name, phone, message }` | 201 | VALIDATION_ERROR, RATE_LIMITED |

Rate limits: reads 120/min/IP; `POST /contact-messages` 5/10min/IP + honeypot field.

## 3. Bookings (Phase 4)

| Method | URL | Auth | Roles | Body / Params | Success | Errors |
|---|---|---|---|---|---|---|
| POST | `/bookings/quote-request` **[USED BY CURRENT UI]** | — | public (guest) | `{ name, phone, vehicleText?, serviceName?, message? }` — mirrors today's form exactly | 201 `{ bookingNumber, status: "REQUESTED" }` — booking row `status=REQUESTED`, `vehicle_text` captured, backend resolves/creates customer-by-phone, generates `MOT-YYYY-NNNNN` | VALIDATION_ERROR, RATE_LIMITED (3/10min/IP), SERVICE_NOT_FOUND (if serviceName mapped), INTERNAL |
| POST | `/bookings` | access | CUSTOMER(+staff) | `{ vehicleId, serviceIds[], scheduledDate, scheduledTime, customerNotes? }` | 201 `{ booking }` | VALIDATION_ERROR, VEHICLE_NOT_FOUND (404 — ownership enforced), SERVICE_NOT_FOUND, GARAGE_CLOSED, RATE_LIMITED |
| GET | `/bookings` | access | CUSTOMER(own) / staff(garage) | `status?`, `from?`, `to?`, page/limit | `{ bookings[], meta }` | UNAUTHORIZED |
| GET | `/bookings/:id` | access | CUSTOMER(own) / staff(garage) | — | booking + statusHistory (customer sees own-actions only) | BOOKING_NOT_FOUND(404 cross-tenant), FORBIDDEN |
| PATCH | `/bookings/:id` | access | SERVICE_ADVISOR+ / customer notes only | customer notes, scheduled slot | 200 | INVALID_STATUS_TRANSITION, FORBIDDEN |
| POST | `/bookings/:id/confirm` | access | SERVICE_ADVISOR+ | `{ scheduledDate, scheduledTime }` | 200 | INVALID_STATUS_TRANSITION |
| POST | `/bookings/:id/check-in` | access | SERVICE_ADVISOR+ | `{ odometer? }` | 200 | INVALID_STATUS_TRANSITION |
| POST | `/bookings/:id/status` | access | SERVICE_ADVISOR+ | `{ status, reason }` — state-machine validated | 200 | INVALID_STATUS_TRANSITION |
| POST | `/bookings/:id/approve` | access | CUSTOMER(own) | `{ findingIds[] }` | 200 | INVALID_STATUS_TRANSITION, FORBIDDEN |
| POST | `/bookings/:id/cancel` | access | CUSTOMER(own) before CHECKED_IN / staff anytime | `{ reason }` | 200 | INVALID_STATUS_TRANSITION |
| GET | `/bookings/:id/history` | access | CUSTOMER(own) / staff | — | statusHistory[] | — |

Transitions enforced server-side per `database.md §2.8`; every change → `booking_status_history` + audit log + queued customer notification.

## 4. Customers & vehicles (Phases 3–4)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| GET | `/customers/me` | access | CUSTOMER | own profile |
| PATCH | `/customers/me` | access | CUSTOMER | address, marketing consents (writes `consents` history) |
| GET | `/customers` | access | SERVICE_ADVISOR+ | garage-scoped, paginated, search by phone/name |
| GET | `/customers/:id` | access | SERVICE_ADVISOR+ | garage-scoped |
| GET | `/vehicles` | access | CUSTOMER(own) / staff(garage) | paginated |
| POST | `/vehicles` | access | CUSTOMER / staff | reg normalized (`KDA 123A`→`KDA123A`), make/model/year validated; UNIQUE (garage, reg, customer) |
| GET | `/vehicles/:id` | access | owner / staff | 404 cross-tenant |
| PATCH | `/vehicles/:id` | access | owner / SERVICE_ADVISOR+ | mileage, notes |
| DELETE | `/vehicles/:id` | access | owner / ADMIN+ | soft delete |
| GET | `/vehicles/lookup?reg=KDA123A` | access | SERVICE_ADVISOR+ | garage-scope dedupe check |

## 5. Diagnostics & repairs (Phase 5)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| POST | `/bookings/:id/diagnostic` | access | MECHANIC | create report (summary) |
| POST | `/diagnostics/:id/findings` | access | MECHANIC | `{ category, severity, finding, recommendation?, estimatedCost?, customerVisible }` |
| PATCH | `/diagnostics/findings/:id` | access | MECHANIC (own report) | — |
| POST | `/diagnostics/:id/publish` | access | SERVICE_ADVISOR+ | sets publishedAt; customer-visible per flag |
| GET | `/bookings/:id/diagnostic` | access | MECHANIC+/CUSTOMER(own, published or visible-only) | customers receive `customer_visible=true` findings only |
| POST | `/repairs` | access | SERVICE_ADVISOR+ | create job from booking+service |
| PATCH | `/repairs/:id` | access | MECHANIC(assigned) | status transitions, hours |
| POST | `/repairs/:id/parts` | access | MECHANIC | `{ partId, quantity }` — **tx: stock decrement + inventory transaction + part_usage** (§47) |
| GET | `/repairs?bookingId=` | access | staff | garage-scoped |

## 6. Inventory & suppliers (Phase 5)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| GET | `/inventory` | access | INVENTORY_MANAGER+ | paginated, low-stock filter |
| POST | `/parts` · PATCH `/parts/:id` | access | INVENTORY_MANAGER+ | sku UNIQUE per garage |
| POST | `/inventory/transactions` | access | INVENTORY_MANAGER+ | **tx: part update + transaction row**; rejects negative stock |
| GET | `/inventory/transactions?partId=` | access | INVENTORY_MANAGER+ | audit trail per part |
| GET/POST/PATCH | `/suppliers(…)` | access | INVENTORY_MANAGER+ | CRUD, garage-scoped |

## 7. Invoices & payments (Phases 6–7)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| POST | `/invoices` | access | CASHIER+ | from booking: backend prices from `repair_jobs`+`part_usages` snapshots; totals computed server-side (§42) |
| POST | `/invoices/:id/items` | access | CASHIER+ | adds item, totals recomputed in tx |
| POST | `/invoices/:id/issue` | access | CASHIER+ | DRAFT→ISSUED, sets dueAt, queues invoice notification |
| POST | `/invoices/:id/void` | access | ADMIN+ | reason required; financial record retained |
| GET | `/invoices/:id` | access | CUSTOMER(own) / staff | |
| GET | `/invoices` | access | CUSTOMER(own) / CASHIER+ | paginated |
| GET | `/invoices/:id/pdf` | access | CUSTOMER(own) / staff | queued PDF job → signed URL |
| POST | `/payments` | access | CASHIER+ | cash/card/bank: `{ invoiceId, amount, method, idempotencyKey }` — **amount capped at balanceDue** (§42) |
| POST | `/payments/mpesa/stk-push` | access | CUSTOMER(own invoice) / CASHIER+ | `{ invoiceId, amount?, phone? }` — backend validates invoice ownership + cap amount to balance; initiates Daraja STK; returns `{ paymentId, status: "INITIATED" }` |
| POST | `/payments/mpesa/callback` | — (Daraja) | public w/ Basic secret check | idempotent: payload_hash + (provider, external_event_id) unique; updates payment+invoice in one tx; answers Daraja `{ResultCode:0}` shape |
| POST | `/payments/mpesa/timeout` | — (Daraja) | public w/ secret check | marks timeout |
| GET | `/payments/:id` | access | CUSTOMER(own) / CASHIER+ | authoritative status — **frontend polls this, never assumes** |
| GET | `/payments?invoiceId=` | access | CUSTOMER(own) / CASHIER+ | history |
| POST | `/payments/:id/reverse` | access | ADMIN+ | creates REVERSAL row + event; never overwrites |
| GET | `/payments/reconcile?date=` | access | ADMIN+ | Daraja transaction-status reconciliation job trigger |

## 8. Notifications (Phase 8)

BullMQ workers handle retries (exponential backoff, attempt caps) with `idempotency_key` per send. Inspection API:

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| GET | `/notifications` | access | ADMIN+ | job status inspection |
| POST | `/notifications/retry/:id` | access | ADMIN+ | manual requeue |

Outbound triggers: booking requested (SMS), confirmed (SMS+WhatsApp), awaiting approval (WhatsApp), ready (WhatsApp), invoice issued (Email+WhatsApp), payment receipt (WhatsApp), low stock (Email→INVENTORY_MANAGER/ADMIN).

## 9. Media (Phase 9)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| POST | `/media/upload-url` | access | MECHANIC+ | `{ entityType, entityId, filename, mimeType, sizeBytes, checksum }` → presigned PUT; allowed types JPEG/PNG/WEBP/MP4 ≤ 25MB; magic-byte check post-upload |
| GET | `/media/:id` | access | owner-scoped | metadata |
| GET | `/media/:id/url` | access | CUSTOMER(own booking media, visible only) / staff | 300s signed URL |
| DELETE | `/media/:id` | access | ADMIN+ | soft-removes metadata; storage GC job |

## 10. Reports & dashboard (Phase 10)

| Method | URL | Auth | Roles | Notes |
|---|---|---|---|---|
| GET | `/reports/revenue` | access | ADMIN+ | by day/service/payment method |
| GET | `/reports/bookings` | access | SERVICE_ADVISOR+ | by status/service/date |
| GET | `/reports/services` | access | ADMIN+ | utilization + revenue per service |
| GET | `/reports/inventory` | access | INVENTORY_MANAGER+ | stock movement, low stock |
| GET | `/reports/payments` | access | ADMIN+ | by method/status/day |
| GET | `/dashboard/summary` | access | ADMIN+ | today's bookings, pipeline counts, vehicles-in-garage, revenue MTD, outstanding invoices, low stock, recent diagnostics/activity |

All report queries use aggregated SQL (§44), validated date ranges, garage-scoped.

## 11. System

| Method | URL | Auth | Notes |
|---|---|---|---|
| GET | `/health` `/health/live` `/health/ready` | — | db+redis checks; no infra details leaked |
| GET | `/docs` (Swagger UI) | dev/staff-gated in prod | OpenAPI 3 |

## 12. Mapping table: current UI element → endpoint

| UI element (file) | Endpoint | Phase |
|---|---|---|
| `ContactPage` form submit | `POST /bookings/quote-request` | 4 |
| `Services` / `ServicesPage` cards | `GET /services` | 2 |
| `Testimonials` section | `GET /testimonials` | 2 |
| `WorkShowcase` + `GalleryPage` | `GET /gallery-items` | 2 |
| `Location`, `Navbar` WhatsApp, `MobileActions`, `Footer`, `TrustBar`, `About` stats | `GET /garages/public/current` | 2 |
| `ContactPage` info cards (hours) | `GET /garages/public/current` | 2 |
| Hero/CTA WhatsApp links | `garages.whatsapp_number` from same endpoint | 2 |
| `ContactPage` "Describe the issue" (no booking intent) | `POST /contact-messages` | 2 |

## 13. Cross-cutting rules (enforced in code)

1. Object-level authz on every `:id` route (garage + ownership check → 404 cross-tenant).
2. `garageId` **never** accepted from client for staff writes; derived from JWT.
3. Financial amounts: server-computed; request amounts validated against server balance (cap, not trust).
4. Idempotency: `idempotency_key` UNIQUE on payments; `payload_hash` on payment_events; duplicate STK callback → 200 with existing result.
5. Rate limiting per route class (login 5/15min/IP+id, payments 5/10min/user, uploads 20/h/user, public reads 120/min/IP).
6. Every request: `requestId` (ULID) bound to logs + error envelope.
