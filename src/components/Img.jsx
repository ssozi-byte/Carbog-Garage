import { useState } from 'react'

/**
 * Image with skeleton shimmer + fade-in. Falls back gracefully offline
 * (skeleton stays, layout intact — no broken-image icon).
 */
export default function Img({ src, alt = '', ratio, imgStyle, ...rest }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#161616',
        aspectRatio: ratio,
        ...rest.style,
      }}
    >
      {!loaded && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(100deg, #141414 40%, #1e1e1e 50%, #141414 60%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.4s infinite linear',
          }}
        />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.6s ease',
          ...imgStyle,
        }}
      />
    </div>
  )
}
