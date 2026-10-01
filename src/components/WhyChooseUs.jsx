import { values } from '../data/testimonials.js'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function WhyChooseUs() {
  const ref = useReveal()

  return (
    <section className="section" ref={ref} style={{ background: 'var(--surface)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div className="container">
        <div data-reveal style={{ maxWidth: 640 }}>
          <p className="kicker">Why MOTORA</p>
          <h2 className="section-title">
            Why drivers <span className="accent">choose us</span>
          </h2>
          <p className="section-sub">
            Anyone can change oil. We built our name on how we handle the hard parts —
            diagnosis, honesty and timelines that hold.
          </p>
        </div>

        <div className="grid-4" style={{ marginTop: 52, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {values.map((v, i) => (
            <div
              key={v.title}
              data-reveal
              style={{
                '--reveal-delay': `${i * 90}ms`,
                padding: '28px 26px',
                borderRadius: 'var(--radius)',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
              }}
            >
              <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icons[v.icon](28)}</span>
              <h3 style={{ fontSize: 18, fontWeight: 800, marginTop: 16 }}>{v.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14.5, marginTop: 10 }}>{v.blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
