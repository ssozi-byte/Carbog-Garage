import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import icons from './Icons.jsx'
import heroLoop from '../assets/hero-loop.mp4'

const poster =
  'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1600&q=70'

export default function Hero() {
  const { garage } = useContentOrStatic()
  const videoRef = useRef(null)
  const [videoOk, setVideoOk] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const tryPlay = () => v.play().then(() => setVideoOk(true)).catch(() => {})
    tryPlay()
    const onClick = () => tryPlay()
    window.addEventListener('pointerdown', onClick, { once: true })
    return () => window.removeEventListener('pointerdown', onClick)
  }, [])

  return (
    <section style={{ position: 'relative', minHeight: '100svh', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      {/* Background media */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        {/* Photo base layer (works even if video is disabled) */}
        <img
          src={poster}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'saturate(0.7) brightness(0.5)',
          }}
        />
        {/* Ambient loop blended on top */}
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={() => setVideoOk(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: videoOk ? 0.72 : 0,
            mixBlendMode: 'screen',
            transition: 'opacity 1.2s ease',
          }}
        >
          <source src={heroLoop} type="video/mp4" />
        </video>
        {/* Cinematic grading */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(11,11,11,0.94) 0%, rgba(11,11,11,0.62) 45%, rgba(11,11,11,0.42) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(11,11,11,0.6) 0%, transparent 30%, #0b0b0b 100%)' }} />
      </div>

      {/* Content */}
      <div className="container" style={{ position: 'relative', paddingTop: 'var(--nav-h)', paddingBottom: 90 }}>
        <p className="kicker">Nairobi · Vehicle Service & Repair</p>

        <h1 className="display" style={{ marginTop: 22, maxWidth: 900 }}>
          Your car.
          <br />
          <span className="outline">Our expertise.</span>
        </h1>

        <p style={{ marginTop: 24, maxWidth: 520, color: 'var(--muted)', fontSize: 18 }}>
          Professional diagnostics, servicing and repair for Japanese, European and
          commercial vehicles — genuine parts, transparent quotes, done on time.
        </p>

        <div style={{ marginTop: 36, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link to="/contact" className="btn btn-accent">
            Book a Service {icons.arrow(18)}
          </Link>
          <a href={garage.whatsapp} target="_blank" rel="noreferrer" className="btn btn-wa">
            {icons.whatsapp(18)} WhatsApp Us
          </a>
        </div>

        {/* Scroll cue */}
        <div
          aria-hidden="true"
          style={{
            marginTop: 64,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--faint)',
            fontSize: 12,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
          }}
        >
          {icons.arrowDown(16)} Scroll
        </div>
      </div>
    </section>
  )
}
