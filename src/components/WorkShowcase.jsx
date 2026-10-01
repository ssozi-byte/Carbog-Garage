import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import Img from './Img.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function WorkShowcase() {
  const ref = useReveal()
  const { works } = useContentOrStatic()

  return (
    <section className="section" ref={ref}>
      <div className="container">
        <div data-reveal style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
          <p className="kicker" style={{ justifyContent: 'center' }}>See us in action</p>
          <h2 className="section-title">
            The work speaks <span className="accent">for itself</span>
          </h2>
          <p className="section-sub" style={{ marginInline: 'auto' }}>
            Diagnostics → Repair → Testing → Delivery. Every job documented, every fix
            verified before the keys go back to you.
          </p>
        </div>

        {/* Feature video frame */}
        <div
          data-reveal
          style={{
            position: 'relative',
            marginTop: 52,
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            border: '1px solid var(--line)',
            cursor: 'pointer',
          }}
          onClick={() => window.open('https://www.youtube.com/results?search_query=car+workshop', '_blank')}
        >
          <Img
            src="https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=1600&q=70"
            ratio="16/7"
            alt="Inside the MOTORA workshop"
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(11,11,11,0.1) 30%, rgba(11,11,11,0.75) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 0 14px rgba(255,122,0,0.18)',
              }}
            >
              {icons.play(30)}
            </span>
          </div>
          <span
            style={{
              position: 'absolute',
              left: 22,
              bottom: 18,
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Inside the MOTORA workshop
          </span>
        </div>

        {/* Recent work grid */}
        <div style={{ marginTop: 44 }}>
          <div data-reveal style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h3 style={{ fontSize: 24, fontWeight: 900, textTransform: 'uppercase' }}>Recent work</h3>
            <a href="/gallery" style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>
              View full gallery →
            </a>
          </div>
          <div className="grid-3" style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {works.slice(0, 3).map((w, i) => (
              <figure
                key={w.id}
                data-reveal
                style={{
                  '--reveal-delay': `${i * 90}ms`,
                  margin: 0,
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                }}
              >
                <Img src={w.img} ratio="4/3" alt={`${w.title} — ${w.vehicle}`} />
                <figcaption style={{ padding: '16px 18px' }}>
                  <span className="tag" style={{ fontSize: 11, padding: '4px 10px' }}>{w.tag}</span>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, marginTop: 10 }}>
                    {w.title}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 2 }}>{w.vehicle}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
