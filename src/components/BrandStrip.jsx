import { useContentOrStatic } from '../api/ContentProvider.jsx'

export default function BrandStrip() {
  const { garage } = useContentOrStatic()
  const row = [...(garage.brands ?? []), ...(garage.brands ?? [])] // duplicate for seamless loop

  return (
    <section style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', overflow: 'hidden', padding: '30px 0' }}>
      <p
        style={{
          textAlign: 'center',
          fontSize: 12,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
          marginBottom: 18,
        }}
      >
        We service all major brands
      </p>
      <div className="marquee">
        <div className="marquee-track">
          {row.map((b, i) => (
            <span
              key={`${b}-${i}`}
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: '0.06em',
                color: 'var(--muted)',
                padding: '0 26px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 26,
              }}
            >
              {b}
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', opacity: 0.7 }} />
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
