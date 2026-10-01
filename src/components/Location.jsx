import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function Location() {
  const ref = useReveal()
  const { garage } = useContentOrStatic()
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(
    `${garage.location.address}, ${garage.location.city}, Kenya`,
  )}&output=embed`

  return (
    <section className="section" ref={ref} id="location" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="container">
        <div data-reveal>
          <p className="kicker">Find us</p>
          <h2 className="section-title">
            Kilimani, <span className="accent">Nairobi</span>
          </h2>
        </div>

        <div className="split-2" style={{ marginTop: 46, display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 18, alignItems: 'stretch' }}>
          {/* Info card */}
          <div
            data-reveal
            style={{
              '--reveal-delay': '80ms',
              padding: '34px 32px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
            }}
          >
            <div style={{ display: 'flex', gap: 14 }}>
              <span style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }}>{icons.pin()}</span>
              <div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>Address</div>
                <div style={{ color: 'var(--muted)', fontSize: 15, marginTop: 4 }}>
                  {garage.location.address}
                  <br />
                  {garage.location.area}, {garage.location.city}, Kenya
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14 }}>
              <span style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }}>{icons.clock()}</span>
              <div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>Opening Hours</div>
                <div style={{ color: 'var(--muted)', fontSize: 15, marginTop: 4 }}>
                  {garage.hours.map((h) => (
                    <div key={h.days} style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                      <span>{h.days}</span>
                      <span>{h.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14 }}>
              <span style={{ color: 'var(--accent)', flex: 'none', marginTop: 2 }}>{icons.phone()}</span>
              <div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>Phone</div>
                <a href={garage.phoneHref} style={{ color: 'var(--muted)', fontSize: 15, marginTop: 4, display: 'inline-block' }}>
                  {garage.phone}
                </a>
              </div>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 8 }}>
              <a href={garage.whatsapp} target="_blank" rel="noreferrer" className="btn btn-wa btn-sm">
                {icons.whatsapp(16)} WhatsApp
              </a>
              <a href={garage.location.directions} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                {icons.pin(16)} Get Directions
              </a>
            </div>
          </div>

          {/* Map */}
          <div
            data-reveal
            style={{
              '--reveal-delay': '160ms',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              border: '1px solid var(--line)',
              minHeight: 380,
            }}
          >
            <iframe
              title="MOTORA Garage location — Ngong Road, Nairobi"
              src={mapSrc}
              style={{ width: '100%', height: '100%', minHeight: 380, border: 0, filter: 'grayscale(0.9) invert(0.92) contrast(0.9)' }}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
