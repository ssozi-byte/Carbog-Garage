# MOTORA — Frontend Analysis (Source of Truth Inventory)

> Inspected: all 31 files under `src/` (5 pages, 16 components, 4 data modules, 1 hook, App shell, CSS).
> Method: file-by-file read of routes, components, forms, data modules, and every `<a>` / `<button>` action.
> Date: 2026-09-29 · Frontend state: MOTORA React/Vite mockup (dark theme, single-tenant content).

---

## 1. Headline Findings

| Area | State |
|---|---|
| API calls | **None.** No `fetch`, no axios, no API layer. |
| Authentication | **None.** No login, no auth state, no tokens, no session logic. |
| Persistence | **None.** No `localStorage`, no `sessionStorage`, no cookies, no DB assumptions. |
| Mock data | 4 modules under `src/data/` (`site.js`, `services.js`, `brands.js`, `testimonials.js`) rendered statically. |
| Forms | **One** — `ContactPage.jsx` booking-request form (5 fields, uncontrolled, `onSubmit` only flips local `sent` state). |
| Payments | **None.** Only `tel:` / `wa.me` links. No M-Pesa UI, no pricing anywhere. |
| Media | Remote Unsplash images + one bundled `hero-loop.mp4`. No uploads. |
| Multi-tenancy | **Single garage hardcoded** in `site.js` (Kilimani, Nairobi). No garage selection UI. |
| Admin surface | **None.** No dashboard route, no staff UI, no auth-gated views. |
| Validation | HTML-only (`required`, `type="tel"`). No JS validation, no zod/yup. |
| State | Local `useState` only (`ContactPage` sent-flag, `GalleryPage` filter, `Navbar` menu open). |

**Conclusion:** the backend must *introduce* auth, customer accounts, and booking management without disturbing the public marketing experience. The public site can remain largely as-is (content source swaps from `src/data/*` to API reads), and the booking form is the single integration point for Phase 4.

---

## 2. Route Inventory (`src/App.jsx`)

| Route | Page component | Public? | Backend relevance |
|---|---|---|---|
| `/` | `Home.jsx` | Yes | Read-only content (services, brands, testimonials, works, location) |
| `/services` | `ServicesPage.jsx` | Yes | Read-only: `GET /services` |
| `/about` | `AboutPage.jsx` | Yes | Read-only: values, stats, one testimonial |
| `/gallery` | `GalleryPage.jsx` | Yes | Read-only: work gallery with tag filter |
| `/contact` | `ContactPage.jsx` | Yes | **Booking form — primary write path** |
| `*` | `NotFound.jsx` | Yes | None |

Global shell: `Navbar` (fixed, 5 links + Book Service CTA → WhatsApp), `Footer`, `MobileActions` (fixed bottom bar: WhatsApp / Call / Directions — `tel:` and `wa.me` only, no API).

---

## 3. Per-Page / Component / Action Analysis

### 3.1 Home (`pages/Home.jsx`)

Composes: `Hero`, `TrustBar`, `About`, `Services`, `WorkShowcase`, `BrandStrip`, `WhyChooseUs`, `HowItWorks`, `Testimonials`, `BookingCTA`, `Location`.

| Component | User action | Required data | API endpoint required | DB tables | Auth | Authz | Validation |
|---|---|---|---|---|---|---|---|
| `Hero` | Watch bg video | none (bundled asset) | — | — | No | — | — |
| `Hero` | "Book a Service" → `/contact` | — | — | — | — | — | — |
| `Hero` | "WhatsApp Us" → `wa.me/254712345678` | garage WhatsApp number | covered by `GET /api/v1/garages/public/current` | garages | No | Public | Phone format server-side |
| `TrustBar` | none (display) | stats (10+ yrs, 2,000+ vehicles, 4.9★, 12 techs) | `GET /api/v1/garages/public/current` (`stats` JSONB or computed later) | garages | No | Public | — |
| `About` | "Meet the Team" → `/about` | — | — | — | — | — | — |
| `Services` | display 6 cards + 3 extras | id, num, title, blurb, icon, points[] | `GET /api/v1/services?active=true` | services | No | Public | Pagination |
| `Services` | "All Services" → `/services` | — | — | — | — | — | — |
| `Services` | "Call for Roadside Assistance" → `tel:` | garage phone | `GET /api/v1/garages/public/current` | garages | No | Public | — |
| `WorkShowcase` | play button (opens YouTube search) | featured video/work item | Phase 2+: `GET /api/v1/gallery-items?type=VIDEO` | media_files, gallery_items (new) | No | Public | — |
| `WorkShowcase` | "View full gallery →" (href `/gallery`) | — | — | — | — | — | — |
| `WorkShowcase` | display 3 recent works | title, vehicle, img, tag | `GET /api/v1/gallery-items?limit=3` | gallery_items, media_files | No | Public | Pagination |
| `BrandStrip` | none (marquee) | brand names | static content / `garages.brands_serviced` | garages | No | Public | — |
| `WhyChooseUs` | display 4 values | title, blurb, icon | static content (CMS later) | — | No | — | — |
| `HowItWorks` | "Book Your Service" → `/contact` | — | — | — | — | — | — |
| `Testimonials` | display 6 reviews | quote, name, area, vehicle, rating | `GET /api/v1/testimonials?approved=true&limit=6` | testimonials (new) | No | Public | Rating 1–5 |
| `BookingCTA` | "Book a Service" → `/contact`; "WhatsApp Us" | — | — | — | — | — | — |
| `Location` | display address/hours/phone | garage profile | `GET /api/v1/garages/public/current` | garages, garage_hours (new) | No | Public | — |
| `Location` | WhatsApp / Get Directions links | garage contact + map URL | same | garages | No | Public | — |

### 3.2 ServicesPage (`pages/ServicesPage.jsx`)

| User action | Required data | API endpoint required | DB tables | Auth | Authz | Validation |
|---|---|---|---|---|---|---|
| View all 6 service cards (+points) | id, num, title, blurb, icon, points[] | `GET /api/v1/services?active=true` | services | No | Public | Pagination |
| View 3 extras | title, blurb, icon | same endpoint (`category=EXTRA`) or static | services | No | Public | — |
| "Call for Roadside Assistance" → `tel:` | garage phone | `GET /api/v1/garages/public/current` | garages | No | Public | — |
| "Book a Diagnostic" → `/contact` | — | — | — | — | — | — |
| "Ask on WhatsApp" → `wa.me` | garage WhatsApp | `GET /api/v1/garages/public/current` | garages | No | Public | — |

### 3.3 AboutPage (`pages/AboutPage.jsx`)

| User action | Required data | API endpoint required | DB tables | Auth | Authz | Validation |
|---|---|---|---|---|---|---|
| Read story + stats + values | narrative (static), 4 stats | `GET /api/v1/garages/public/current` (stats) | garages | No | Public | — |
| Read featured testimonial | quote, name, area | `GET /api/v1/testimonials?featured=true` | testimonials | No | Public | — |
| (CTA) `BookingCTA` | — | — | — | — | — | — |

### 3.4 GalleryPage (`pages/GalleryPage.jsx`)

| User action | Required data | API endpoint required | DB tables | Auth | Authz | Validation |
|---|---|---|---|---|---|---|
| Filter chips (All / Engine / Brakes / Suspension / Diagnostics / AC & Cooling / Electrical) | distinct tags | `GET /api/v1/gallery-items?tags=...` | gallery_items, media_files | No | Public | Tag enum/pagination |
| View 6 work cards | title, vehicle, img URL, tag | same | gallery_items, media_files | No | Public | Signed/public URLs for marketing media |
| (CTA) `BookingCTA` | — | — | — | — | — | — |

### 3.5 ContactPage (`pages/ContactPage.jsx`) — **the one write path**

Form fields (exact, from source):

| Field | Widget | Frontend validation | Notes |
|---|---|---|---|
| Your Name | `input required` | HTML required | Free text, no max length |
| Phone / WhatsApp | `input type="tel" required` | HTML required only | Placeholder `+254 7XX XXX XXX` |
| Vehicle (Make & Model) | `input` | none (optional) | Single free-text field — see Mismatch M1 |
| Service Needed | `select` (8 hardcoded options) | none | Option list must come from `services` table — see Mismatch M2 |
| Describe the issue | `textarea rows=5` | none (optional) | Free text |

Flow: submit → `setSent(true)` → success card ("Request received") with WhatsApp link. **No API call is made today; the success state is simulated.**

| User action | Required data | API endpoint required | DB tables | Auth | Authz | Validation |
|---|---|---|---|---|---|---|
| Submit booking request | name, phone, vehicleText, serviceName, issueNotes | `POST /api/v1/bookings/quote-request` (guest) or `POST /api/v1/bookings` (authenticated) | bookings, vehicles, customer_profiles, users | No (guest allowed today); auth later | Public + rate-limited | Name ≤120; phone E.164 KE (+2547XXXXXXXX); serviceId ∈ garage services; scheduled date/time optional→staff confirms; notes ≤2000; consent flag |
| View info cards (call/WhatsApp/hours/email) | garage contact data | `GET /api/v1/garages/public/current` | garages, garage_hours | No | Public | — |

### 3.6 Global components

| Component | Action | Data need | Endpoint |
|---|---|---|---|
| `Navbar` | 5 route links + Book Service (WhatsApp) | garage WhatsApp | `GET /api/v1/garages/public/current` |
| `Footer` | social links (`#` placeholders), contact, nav | garage socials/email | same |
| `MobileActions` | WhatsApp / Call / Directions | garage phone, WhatsApp, directions URL | same |
| `PageHero` | breadcrumb "Book on WhatsApp" | garage WhatsApp | same |
| `Img` | lazy image with shimmer | image URLs (today: Unsplash) | later: `GET /api/v1/media/:id/url` (signed) for private media; public marketing media stays CDN/public URL |

---

## 4. Data Currently Hardcoded (mock → future API source)

| `src/data/` module | Contents | Future source |
|---|---|---|
| `site.js` | Garage identity, phone, WhatsApp, email, Kilimani address, hours[3], socials[4], nav[5], stats[4] | `garages`, `garage_hours` rows (seeded) → `GET /garages/public/current` |
| `services.js` | 6 core services (num/icon/points) + 3 extras | `services` table (seeded from these exact titles) |
| `brands.js` | 12 brand names + 6 `works` items (title/vehicle/img/tag) | `garages.brands_serviced` + `gallery_items` + `media_files` |
| `testimonials.js` | 6 reviews + 4 values | `testimonials` table (admin-approved) ; values remain static copy |

---

## 5. User Flows Observed (end-to-end)

1. **Marketing browse flow** (all pages): view content → click service/book CTAs → land on `/contact`. No data entry until contact page.
2. **Contact flow (today)**: fill 5-field form → instant fake success → WhatsApp fallback link. No account, no vehicle record, no booking persisted.
3. **Offline-contact flows**: WhatsApp deep link (prefilled text), `tel:` call, Google Maps directions. These bypass the backend entirely — must keep working (Rule 3).
4. **Gallery filter flow**: client-side tag filter over 6 mock items.

## 6. Missing Frontend Capabilities the Backend Must Support (Phases 3–10)

- Auth UI (register/login/refresh/logout, sessions) — none exists; backend builds API first, frontend screens later.
- Customer portal data: my vehicles, my bookings + status history, my invoices, diagnostic reports with `customer_visible=true` findings.
- Staff/admin dashboard data: today's bookings, status pipeline, inventory, revenue, low stock, audit trail.
- Payments: no M-Pesa UI exists — backend builds `POST /payments/mpesa/stk-push` + callback; UI comes later.
- Notifications: no email/phone capture beyond the booking form → backend sends confirmations via queued SMS/WhatsApp using booking form data.
- Media upload: no upload UI; backend provides staff upload + signed URL APIs for diagnostic media (Phase 9).

## 7. Security Observations on Current Frontend

- No secrets exposed (nothing to leak — good baseline).
- WhatsApp/call links are public business contact info — fine to keep public.
- Form has no honeypot/rate-limit awareness — backend must add rate limiting (`POST /bookings/quote-request`) and spam protection since the form is public.
- No `VITE_*` vars at all yet; when added, only `VITE_API_URL` is permitted (Spec §55).

## 8. Gaps & Mismatches to Resolve (per Spec §69.5 — flagged, not silently changed)

| # | Mismatch | Impact | Proposed resolution |
|---|---|---|---|
| M1 | Form collects vehicle as **one free-text field** ("Toyota Fielder 2016"); DB spec wants structured `vehicles` (make/model/year/registration). | Booking → vehicle linkage | Phase 4: guest bookings store raw text in `bookings.customer_notes` context field `vehicle_text` AND best-effort parsed make/model; authenticated flow uses proper `vehicles` records. No frontend redesign required now. |
| M2 | `select` has **8 hardcoded service options**; DB `services` table is admin-editable with different names (e.g. "Brake Service" vs "Brakes"). | Option list drift | Seed `services` with these exact 8 titles as slugs; later swap `<select>` options to `GET /services` (small, UI-preserving change). |
| M3 | No date/time picker in form; DB `bookings.scheduled_date/time` required. | Booking scheduling | Treat as **quote request** (`status=REQUESTED`, no slot) — staff confirms time via call/WhatsApp; add date/time UI later. |
| M4 | Single-tenant hardcoded garage; spec is multi-tenant. | Tenancy | DB carries `garage_id` from day 1; public APIs operate on the "current" garage resolved from domain/config; seed one garage (Kilimani). |
| M5 | Testimonials/Gallery/Values have no admin path in frontend. | Content management | `testimonials` + `gallery_items` tables + admin CRUD APIs (Phase 10); frontend keeps reading via public endpoints. |
| M6 | Marketing media uses hotlinked Unsplash URLs; spec mandates private storage for **customer** media. | Media policy | Two classes: `visibility=PUBLIC` marketing media (gallery) served via public URL/CDN; `visibility=PRIVATE` diagnostic media via short-lived signed URLs. Mockup images stay as-is until client provides real photos. |

## 9. Backend Requirements Summary (derived strictly from the above)

- **Endpoints needed by current UI (Phase 2–4 minimum):** `GET /garages/public/current`, `GET /services`, `GET /testimonials`, `GET /gallery-items`, `POST /bookings/quote-request` (guest, rate-limited).
- **Auth:** none required for anything the UI does today — but spec mandates full auth system; build in Phase 3 and gate staff/customer endpoints only.
- **Payments:** not reachable from any current UI element; build per spec (Phase 6–7) for the operations roadmap.
- **Notifications:** booking confirmation SMS/WhatsApp on quote-request submission is the first real trigger.
- **DB entities touched by current UI:** garages, garage_hours, services, testimonials, gallery_items, media_files, users, customer_profiles, vehicles, bookings, booking_status_history (+ the Phase 5–6 operational tables for the platform behind the scenes).
