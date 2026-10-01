import { useMemo, useState } from 'react'
import PageHero from '../components/PageHero.jsx'
import BookingCTA from '../components/BookingCTA.jsx'
import Img from '../components/Img.jsx'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import { useReveal } from '../hooks/useReveal.js'

export default function GalleryPage() {
  const ref = useReveal()
  const { works } = useContentOrStatic()
  const tags = useMemo(() => ['All', ...new Set(works.map((w) => w.tag))], [works])
  const [filter, setFilter] = useState('All')

  const shown = filter === 'All' ? works : works.filter((w) => w.tag === filter)

  return (
    <>
      <PageHero
        kicker="Our work"
        title={
          <>
            Recent jobs, <span style={{ color: 'var(--accent)' }}>real results.</span>
          </>
        }
        sub="A sample of what leaves our workshop every week — documented, tested and guaranteed."
        image="https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1600&q=70"
      />

      <section className="section" ref={ref}>
        <div className="container">
          {/* Filters */}
          <div data-reveal style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="btn btn-sm"
                style={
                  filter === t
                    ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                    : { border: '1px solid var(--line-strong)', color: 'var(--muted)', background: 'transparent' }
                }
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid-3" style={{ marginTop: 34, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {shown.map((w, i) => (
              <figure
                key={w.id}
                data-reveal
                style={{
                  '--reveal-delay': `${(i % 3) * 80}ms`,
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

          <p
            data-reveal
            style={{
              marginTop: 40,
              textAlign: 'center',
              color: 'var(--faint)',
              fontSize: 14,
            }}
          >
            For a real client site, this grid would showcase the garage’s own before/after
            photos and short repair clips.
          </p>
        </div>
      </section>

      <BookingCTA />
    </>
  )
}
