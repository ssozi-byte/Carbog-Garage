# MOTORA Garage — React Mockup

A premium dark-themed Kenyan garage website mockup (fictional brand "MOTORA") built with **React 18 + Vite + React Router**. Visual direction inspired by Webflow automotive templates, adapted for the Kenyan market (local vehicles, WhatsApp-first contact, mobile action bar, Kenyan place names).

## Backend (in progress) & live data

A NestJS + PostgreSQL + Prisma backend lives in [`backend/`](backend/README.md) — see [`docs/architecture.md`](docs/architecture.md) for the full design, [`docs/frontend-analysis.md`](docs/frontend-analysis.md) for how the frontend maps to APIs, and the phase plan (auth → bookings → operations → billing → M-Pesa → notifications).

The frontend now fetches live content (garage profile, services, testimonials, gallery) through a centralized API layer (`src/api/`) with the backend's public content endpoints. If the API is unreachable, the site falls back to the original `src/data/*` static content so the public pages always render. Configure the API base with `VITE_API_URL` (see `.env.example`); never put secrets in `VITE_*` vars.

## Run it

```bash
npm install
npm run dev      # dev server on :5173
npm run build    # production build to dist/
npm run preview  # serve the production build
```

## Structure

```
src/
├── assets/            # generated hero ambient loop (ffmpeg)
├── components/        # Navbar, Hero, TrustBar, About, Services, WorkShowcase,
│                      # BrandStrip, WhyChooseUs, HowItWorks, Testimonials,
│                      # BookingCTA, Location, Footer, PageHero, Img, Icons
├── pages/             # Home, ServicesPage, AboutPage, GalleryPage, ContactPage, NotFound
├── data/              # site.js, services.js, brands.js, testimonials.js  ← edit content here
├── hooks/             # useReveal (scroll animations), useScrolled (navbar state)
├── App.jsx            # routes
├── main.jsx
└── index.css          # design tokens + responsive rules
```

## Notes

- All content (phone, WhatsApp link, address, services, reviews) lives in `src/data/` — swap in the real client's data in one place.
- Images are Unsplash placeholders; the hero background is a locally generated ambient loop so the site has no broken third-party video dependencies.
- The contact form is front-end only (demo state); wire it to a backend or a service like Formspree when going live.
