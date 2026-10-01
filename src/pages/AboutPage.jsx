import PageHero from '../components/PageHero.jsx'
import BookingCTA from '../components/BookingCTA.jsx'
import Img from '../components/Img.jsx'
import icons from '../components/Icons.jsx'
import { values } from '../data/testimonials.js'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function AboutPage() {
  const ref = useReveal()
  const { garage, testimonials } = useContentOrStatic()

  return (
    <>
      <PageHero
        kicker="About us"
        title={
          <>
            The garage that <span style={{ color: 'var(--accent)' }}>explains.</span>
          </>
        }
        sub="Ten years of keeping Nairobi moving — one honest diagnosis at a time."
        image="https://images.unsplash.com/photo-1625047509168-a7026f36de04?auto=format&fit=crop&w=1600&q=70"
      />

      <section className="section" ref={ref}>
        <div className="container">
          <div className="split-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
            <div data-reveal>
              <Img
                src="https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?auto=format&fit=crop&w=1200&q=70"
                ratio="4/3"
                alt="MOTORA workshop floor"
              />
            </div>
            <div data-reveal style={{ '--reveal-delay': '120ms' }}>
              <p className="kicker">Our story</p>
              <h2 className="section-title">
                Built on <span className="accent">trust</span>, kept by results
              </h2>
              <p style={{ marginTop: 18, color: 'var(--muted)', fontSize: 16.5 }}>
                MOTORA started in 2015 as a two-bay workshop off Ngong Road with one rule:
                never invoice a customer for something they did not approve. Ten years and
                two thousand vehicles later, that rule has not changed.
              </p>
              <p style={{ marginTop: 14, color: 'var(--muted)', fontSize: 16.5 }}>
                Today our twelve certified technicians handle everything from a Probox oil
                service to a full Subaru engine rebuild — with the same written job card,
                the same genuine parts and the same straight answers.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid-4" data-reveal style={{ marginTop: 80, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
            {(garage.stats ?? []).map((s) => (
              <div
                key={s.label}
                style={{
                  textAlign: 'center',
                  padding: '30px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 38, color: 'var(--accent)' }}>
                  {s.value}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Values */}
          <div className="grid-4" data-reveal style={{ marginTop: 90 }}>
            <p className="kicker">How we work</p>
            <h2 className="section-title">What we stand for</h2>
            <div style={{ marginTop: 44, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
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

          {/* Featured review */}
          <figure
            data-reveal
            style={{
              margin: '90px auto 0',
              maxWidth: 760,
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'flex', gap: 3, justifyContent: 'center', color: 'var(--accent)' }}>
              {Array.from({ length: 5 }).map((_, s) => (
                <span key={s}>{icons.star(16)}</span>
              ))}
            </div>
            <blockquote style={{ margin: '18px 0 0', fontSize: 20, lineHeight: 1.6, fontFamily: 'var(--font-display)', fontWeight: 600 }}>
              “{testimonials[0].quote}”
            </blockquote>
            <figcaption style={{ marginTop: 14, color: 'var(--muted)', fontSize: 14 }}>
              — {testimonials[0].name}, {testimonials[0].area}
            </figcaption>
          </figure>
        </div>
      </section>

      <BookingCTA />
    </>
  )
}
