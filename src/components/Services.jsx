import { Link } from 'react-router-dom'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export function ServiceCard({ s, delay = 0 }) {
  return (
    <article
      data-reveal
      style={{
        '--reveal-delay': `${delay}ms`,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: '30px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        transition: 'transform .25s ease, border-color .25s ease, background .25s ease',
      }}
      className="service-card"
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)'
        e.currentTarget.style.transform = 'translateY(-4px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)'
        e.currentTarget.style.transform = 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icons[s.icon](30)}</span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 14,
            color: 'var(--faint)',
            letterSpacing: '0.1em',
          }}
        >
          {s.num}
        </span>
      </div>
      <h3 style={{ fontSize: 21, fontWeight: 800 }}>{s.title}</h3>
      <p style={{ color: 'var(--muted)', fontSize: 15, flex: 1 }}>{s.blurb}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 7 }}>
        {s.points.map((p) => (
          <li key={p} style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5, color: 'var(--text)' }}>
            <span style={{ color: 'var(--accent)' }}>{icons.check(13)}</span>
            {p}
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function Services() {
  const ref = useReveal()
  const { services, extras } = useContentOrStatic()

  return (
    <section className="section" ref={ref} style={{ background: '#0e0e0e', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div className="container">
        <div data-reveal style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <p className="kicker">What we do</p>
            <h2 className="section-title">
              Our <span className="accent">services</span>
            </h2>
            <p className="section-sub">
              Dealer-level diagnostics and honest workmanship for Japanese, European and
              commercial vehicles.
            </p>
          </div>
          <Link to="/services" className="btn btn-ghost btn-sm">
            All Services {icons.arrow(16)}
          </Link>
        </div>

        <div
          className="grid-3"
          style={{
            marginTop: 48,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 18,
          }}
        >
          {services.map((s, i) => (
            <ServiceCard key={s.id} s={s} delay={(i % 3) * 90} />
          ))}
        </div>

        {/* Kenyan extras */}
        <div className="grid-3" style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {extras.map((x, i) => (
            <div
              key={x.id}
              data-reveal
              style={{
                '--reveal-delay': `${(i % 3) * 90}ms`,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                padding: '22px 24px',
                border: '1px dashed var(--line-strong)',
                borderRadius: 'var(--radius)',
              }}
            >
              <span style={{ color: 'var(--accent)', flex: 'none' }}>{icons[x.icon](24)}</span>
              <div>
                <h4 style={{ fontSize: 16, fontWeight: 800 }}>{x.title}</h4>
                <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{x.blurb}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Roadside strip */}
        <div
          data-reveal
          style={{
            marginTop: 26,
            borderRadius: 'var(--radius)',
            border: '1px solid var(--accent-dim)',
            background: 'var(--accent-dim)',
            padding: '26px 30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 900, textTransform: 'uppercase' }}>
              Need help on the road?
            </h3>
            <p style={{ color: 'var(--muted)', marginTop: 6 }}>
              Breakdown within Nairobi? Our response team is one call away.
            </p>
          </div>
          <a href="tel:+254712345678" className="btn btn-accent">
            {icons.phone(18)} Call for Roadside Assistance
          </a>
        </div>
      </div>
    </section>
  )
}
