import { Link } from 'react-router-dom'
import icons from './Icons.jsx'
import Img from './Img.jsx'
import { useReveal } from '../hooks/useReveal.js'

const img =
  'https://images.unsplash.com/photo-1625047509168-a7026f36de04?auto=format&fit=crop&w=1200&q=70'

export default function About() {
  const ref = useReveal()

  return (
    <section className="section" ref={ref}>
      <div className="container">
        <div className="split-2" style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 64, alignItems: 'center' }}>
          {/* Image side */}
          <div data-reveal style={{ position: 'relative' }}>
            <Img src={img} ratio="4/3" alt="MOTORA technician servicing an engine" />
            <div
              style={{
                position: 'absolute',
                right: -14,
                bottom: -14,
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                borderRadius: 12,
                padding: '18px 22px',
                fontFamily: 'var(--font-display)',
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 30, lineHeight: 1 }}>10+</div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em' }}>YEARS</div>
            </div>
          </div>

          {/* Copy side */}
          <div data-reveal style={{ '--reveal-delay': '120ms' }}>
            <p className="kicker">About the garage</p>
            <h2 className="section-title">
              Built around <span className="accent">your car</span>
            </h2>
            <p style={{ marginTop: 18, color: 'var(--muted)', fontSize: 17 }}>
              From routine servicing to complex diagnostics, we handle every job with the
              same discipline: listen to the customer, diagnose before we quote, and fix it
              once. Our Kilimani workshop runs on genuine parts and straight answers.
            </p>
            <ul style={{ marginTop: 24, listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
              {['Diagnose before we quote — always', 'Genuine & OEM-equivalent parts only', 'Written job card with every service'].map((t) => (
                <li key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)', marginTop: 3 }}>{icons.check(16)}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Link to="/about" className="btn btn-ghost" style={{ marginTop: 32 }}>
              Meet the Team {icons.arrow(18)}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
