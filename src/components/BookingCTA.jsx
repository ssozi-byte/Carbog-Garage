import { Link } from 'react-router-dom'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function BookingCTA() {
  const ref = useReveal()
  const { garage } = useContentOrStatic()

  return (
    <section className="section" ref={ref} style={{ overflow: 'hidden' }}>
      <div className="container" style={{ textAlign: 'center' }}>
        <div data-reveal>
          <p className="kicker" style={{ justifyContent: 'center' }}>Ready when you are</p>
          <h2 className="display" style={{ marginTop: 16 }}>
            Your car deserves
            <br />
            <span className="accent">proper care.</span>
          </h2>
          <p style={{ marginTop: 22, color: 'var(--muted)', fontSize: 17 }}>
            Need a service, repair or diagnosis? Talk to us today.
          </p>
          <div style={{ marginTop: 34, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/contact" className="btn btn-accent">Book a Service {icons.arrow(18)}</Link>
            <a href={garage.whatsapp} target="_blank" rel="noreferrer" className="btn btn-wa">
              {icons.whatsapp(18)} WhatsApp Us
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
