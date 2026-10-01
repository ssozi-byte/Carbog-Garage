import { Link } from 'react-router-dom'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

const steps = [
  {
    num: '01',
    title: 'Contact',
    text: 'Tell us what is wrong with your vehicle — call, WhatsApp or book online.',
  },
  {
    num: '02',
    title: 'Diagnose',
    text: 'We inspect the vehicle, run diagnostics and identify the exact issue.',
  },
  {
    num: '03',
    title: 'Repair',
    text: 'We repair your vehicle and keep you updated until it is ready for pickup.',
  },
]

export default function HowItWorks() {
  const ref = useReveal()

  return (
    <section className="section" ref={ref}>
      <div className="container">
        <div data-reveal style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div>
            <p className="kicker">Simple process</p>
            <h2 className="section-title">How it works</h2>
          </div>
          <Link to="/contact" className="btn btn-accent btn-sm">Book Your Service {icons.arrow(16)}</Link>
        </div>

        <div className="grid-3" style={{ marginTop: 54, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {steps.map((s, i) => (
            <div
              key={s.num}
              data-reveal
              style={{
                '--reveal-delay': `${i * 110}ms`,
                position: 'relative',
                padding: '34px 30px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--line)',
                background: i === 1 ? 'var(--surface)' : 'transparent',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 900,
                  fontSize: 64,
                  lineHeight: 1,
                  color: 'transparent',
                  WebkitTextStroke: '1.5px var(--accent)',
                }}
              >
                {s.num}
  </span>
              <h3 style={{ fontSize: 24, fontWeight: 900, textTransform: 'uppercase', marginTop: 18 }}>{s.title}</h3>
              <p style={{ color: 'var(--muted)', marginTop: 10, maxWidth: 320 }}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
