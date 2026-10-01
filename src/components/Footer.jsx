import { Link } from 'react-router-dom'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import { nav } from '../data/site.js'
import { servicesFallback } from '../api/fallbacks.js'
import icons from './Icons.jsx'

export default function Footer() {
  const { garage, services } = useContentOrStatic()
  // Footer lists the marketing services (or static fallback pre-load)
  const footerServices = services.length ? services : servicesFallback

  return (
    <footer style={{ borderTop: '1px solid var(--line)', background: '#080808', paddingTop: 64 }}>
      <div className="container">
        <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr', gap: 40 }}>
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
                <rect width="32" height="32" rx="6" fill="#111" stroke="var(--line-strong)" />
                <path d="M8 22V10l4 6 4-6 4 6 4-6v12" stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 19, letterSpacing: '0.08em' }}>
                MOTORA
              </span>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 14.5, marginTop: 16, maxWidth: 280 }}>
              Professional vehicle service & repair in Nairobi. Genuine parts, honest
              diagnostics, work guaranteed.
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
              {(garage.socials ?? []).map((s) => (
                <a
                  key={s.label}
                  href={s.href ?? '#'}
                  aria-label={s.label}
                  style={{
                    width: 38,
                    height: 38,
                    border: '1px solid var(--line-strong)',
                    borderRadius: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--muted)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {String(s.label).slice(0, 2)}
                </a>
              ))}
            </div>
          </div>

          {/* Explore */}
          <div>
            <h4 style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)' }}>Explore</h4>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 10 }}>
              {nav.map((n) => (
                <li key={n.to}>
                  <Link to={n.to} style={{ color: 'var(--muted)', fontSize: 14.5 }}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h4 style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)' }}>Services</h4>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 10 }}>
              {footerServices.map((s) => (
                <li key={s.id ?? s.slug}>
                  <Link to="/services" style={{ color: 'var(--muted)', fontSize: 14.5 }}>{s.title ?? s.name}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)' }}>Contact</h4>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 12, color: 'var(--muted)', fontSize: 14.5 }}>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--accent)' }}>{icons.pin(17)}</span>
                {garage.location.address}, {garage.location.area}, {garage.location.city}
              </li>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--accent)' }}>{icons.phone(17)}</span>
                <a href={garage.phoneHref}>{garage.phone}</a>
              </li>
              <li style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--accent)' }}>{icons.mail(17)}</span>
                <a href={`mailto:${garage.email}`}>{garage.email}</a>
              </li>
            </ul>
          </div>
        </div>

        <div
          style={{
            marginTop: 56,
            padding: '20px 0 26px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            color: 'var(--faint)',
            fontSize: 13,
          }}
        >
          <span>© {new Date().getFullYear()} {garage.fullName ?? garage.name}. All rights reserved.</span>
          <span>Proudly Kenyan 🇰🇪 · Demo mockup — not a real business</span>
        </div>
      </div>
    </footer>
  )
}
