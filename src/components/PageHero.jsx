import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useContentOrStatic } from '../api/ContentProvider.jsx'

export default function PageHero({ kicker, title, sub, image }) {
  const { garage } = useContentOrStatic()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <header
      style={{
        position: 'relative',
        padding: '170px 0 84px',
        overflow: 'hidden',
        borderBottom: '1px solid var(--line)',
      }}
    >
      {image && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.18,
            filter: 'saturate(0.8)',
          }}
        />
      )}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(11,11,11,0.55) 0%, rgba(11,11,11,0.82) 70%, #0b0b0b 100%)',
        }}
      />
      <div className="container" style={{ position: 'relative' }}>
        <p
          className="kicker"
          style={{
            opacity: ready ? 1 : 0,
            transform: ready ? 'none' : 'translateY(14px)',
            transition: 'opacity .6s ease, transform .6s ease',
          }}
        >
          {kicker}
        </p>
        <h1
          className="display"
          style={{
            marginTop: 12,
            opacity: ready ? 1 : 0,
            transform: ready ? 'none' : 'translateY(20px)',
            transition: 'opacity .7s ease .08s, transform .7s ease .08s',
          }}
        >
          {title}
        </h1>
        {sub && (
          <p
            style={{
              marginTop: 18,
              maxWidth: 620,
              color: 'var(--muted)',
              fontSize: 17,
              opacity: ready ? 1 : 0,
              transform: ready ? 'none' : 'translateY(20px)',
              transition: 'opacity .7s ease .16s, transform .7s ease .16s',
            }}
          >
            {sub}
          </p>
        )}
        <p
          style={{
            marginTop: 26,
            fontSize: 13,
            color: 'var(--faint)',
            letterSpacing: '0.04em',
            opacity: ready ? 1 : 0,
            transition: 'opacity .7s ease .24s',
          }}
        >
          <Link to="/" style={{ color: 'var(--muted)' }}>Home</Link>
          <span style={{ margin: '0 10px', color: 'var(--accent)' }}>/</span>
          {typeof title === 'string' ? title : 'Page'}
          <span style={{ margin: '0 14px' }}>·</span>
          <a href={garage.whatsapp} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            Book on WhatsApp
          </a>
        </p>
      </div>
    </header>
  )
}
