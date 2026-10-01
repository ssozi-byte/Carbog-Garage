import { Link } from 'react-router-dom'
import icons from '../components/Icons.jsx'

export default function NotFound() {
  return (
    <section className="section" style={{ minHeight: '70vh', display: 'flex', alignItems: 'center' }}>
      <div className="container" style={{ textAlign: 'center' }}>
        <p className="kicker" style={{ justifyContent: 'center' }}>404</p>
        <h1 className="display" style={{ marginTop: 14 }}>
          Lost <span className="accent">route.</span>
        </h1>
        <p style={{ color: 'var(--muted)', marginTop: 16 }}>
          That page took a wrong turn. Let’s get you back on the road.
        </p>
        <Link to="/" className="btn btn-accent" style={{ marginTop: 28 }}>
          Back to Home {icons.arrow(18)}
        </Link>
      </div>
    </section>
  )
}
