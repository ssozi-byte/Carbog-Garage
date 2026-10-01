import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'

const claims = ['Qualified Technicians', 'Genuine Parts', 'Transparent Pricing']

export default function TrustBar() {
  const { garage } = useContentOrStatic()
  const stats = garage.stats ?? []

  return (
    <section
      style={{
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}
    >
      <div
        className="container trust-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 1,
          background: 'var(--line)',
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              background: 'var(--surface)',
              padding: '28px 8px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 900,
                fontSize: 'clamp(26px, 3.2vw, 40px)',
                color: 'var(--accent)',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div
        className="container"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 28px',
          justifyContent: 'center',
          padding: '16px 0 22px',
        }}
      >
        {claims.map((c) => (
          <span key={c} className="tag">
            {icons.check(15)} {c}
          </span>
        ))}
      </div>
    </section>
  )
}
