import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function Testimonials() {
  const ref = useReveal()
  const { testimonials } = useContentOrStatic()

  return (
    <section className="section" ref={ref} style={{ background: '#0e0e0e', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div className="container">
        <div data-reveal style={{ maxWidth: 640 }}>
          <p className="kicker">Customer reviews</p>
          <h2 className="section-title">
            Trusted by Nairobi <span className="accent">drivers</span>
          </h2>
          <p className="section-sub">
            Real feedback from real customers — the kind we want more of.
          </p>
        </div>

        <div className="grid-3" style={{ marginTop: 52, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {testimonials.slice(0, 6).map((t, i) => (
            <figure
              key={t.name}
              data-reveal
              style={{
                '--reveal-delay': `${(i % 3) * 90}ms`,
                margin: 0,
                padding: '28px 26px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', gap: 3, color: 'var(--accent)' }}>
                {Array.from({ length: t.rating }).map((_, s) => (
                  <span key={s}>{icons.star(15)}</span>
                ))}
              </div>
              <blockquote style={{ margin: 0, fontSize: 15, color: 'var(--text)', lineHeight: 1.65, flex: 1 }}>
                “{t.quote}”
              </blockquote>
              <figcaption style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>{t.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                  {t.vehicle} · {t.area}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
