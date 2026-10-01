import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero.jsx'
import { ServiceCard } from '../components/Services.jsx'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from '../components/Icons.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function ServicesPage() {
  const ref = useReveal()
  const { garage, services, extras } = useContentOrStatic()

  return (
    <>
      <PageHero
        kicker="Services"
        title={
          <>
            Everything your car <span style={{ color: 'var(--accent)' }}>needs.</span>
          </>
        }
        sub="Diagnostics, servicing, repair and roadside support — one workshop for Japanese, European and commercial vehicles."
        image="https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=1600&q=70"
      />

      <section className="section" ref={ref}>
        <div className="container">
          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {services.map((s, i) => (
              <ServiceCard key={s.id} s={s} delay={(i % 3) * 90} />
            ))}
          </div>

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
            <a href={garage.phoneHref} className="btn btn-accent">
              {icons.phone(18)} Call for Roadside Assistance
            </a>
          </div>

          <div data-reveal style={{ textAlign: 'center', marginTop: 70 }}>
            <h2 className="section-title" style={{ fontSize: 'clamp(26px, 3.6vw, 40px)' }}>
              Not sure what your car needs?
            </h2>
            <p className="section-sub" style={{ margin: '14px auto 0' }}>
              Bring it in for a computer diagnostic — we will tell you exactly what is wrong
              and what it will cost before any work starts.
            </p>
            <div style={{ marginTop: 28, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/contact" className="btn btn-accent">Book a Diagnostic {icons.arrow(18)}</Link>
              <a href={garage.whatsapp} target="_blank" rel="noreferrer" className="btn btn-wa">
                {icons.whatsapp(18)} Ask on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
