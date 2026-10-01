import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useScrolled } from '../hooks/useReveal.js'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import { nav } from '../data/site.js'
import icons from './Icons.jsx'

export default function Navbar() {
  const scrolled = useScrolled(24)
  const [open, setOpen] = useState(false)
  const { garage } = useContentOrStatic()

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        borderBottom: `1px solid ${scrolled || open ? 'var(--line)' : 'transparent'}`,
        background: scrolled || open ? 'rgba(11,11,11,0.88)' : 'transparent',
        backdropFilter: scrolled || open ? 'blur(14px)' : 'none',
        WebkitBackdropFilter: scrolled || open ? 'blur(14px)' : 'none',
        transition: 'background .25s ease, border-color .25s ease',
      }}
    >
      <div
        className="container"
        style={{
          height: 'var(--nav-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
        }}
      >
        {/* Logo */}
        <Link to="/" onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="#0b0b0b" stroke="var(--line-strong)" />
            <path
              d="M8 22V10l4 6 4-6 4 6 4-6v12"
              stroke="var(--accent)"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              fontSize: 20,
              letterSpacing: '0.08em',
            }}
          >
            MOTORA
          </span>
        </Link>

        {/* Desktop nav */}
        <nav
          style={{
            display: 'flex',
            gap: 30,
            alignItems: 'center',
          }}
          className="nav-links"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: isActive ? 'var(--accent)' : 'var(--muted)',
                transition: 'color .2s ease',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Desktop CTA */}
        <a
          href={garage.whatsapp}
          target="_blank"
          rel="noreferrer"
          className="btn btn-accent btn-sm"
          style={{ display: 'inline-flex' }}
          id="nav-cta"
        >
          Book Service
        </a>

        {/* Mobile toggle */}
        <button
          className="nav-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          style={{
            display: 'none',
            background: 'none',
            border: '1px solid var(--line-strong)',
            borderRadius: 10,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text)',
          }}
        >
          {open ? icons.close() : icons.menu()}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          style={{
            display: 'none',
            flexDirection: 'column',
            gap: 4,
            padding: '8px 24px 24px',
            background: 'rgba(11,11,11,0.97)',
          }}
          className="mobile-menu"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              style={({ isActive }) => ({
                padding: '13px 4px',
                borderBottom: '1px solid var(--line)',
                fontSize: 17,
                fontWeight: 600,
                color: isActive ? 'var(--accent)' : 'var(--text)',
              })}
            >
              {item.label}
            </NavLink>
          ))}
          <a
            href={garage.whatsapp}
            target="_blank"
            rel="noreferrer"
            className="btn btn-accent"
            style={{ marginTop: 18 }}
          >
            {icons.whatsapp(18)} Book Service
          </a>
        </div>
      )}
    </header>
  )
}
