import { useState } from 'react'
import PageHero from '../components/PageHero.jsx'
import icons from '../components/Icons.jsx'
import { useContentOrStatic } from '../api/ContentProvider.jsx'
import { submitQuoteRequest } from '../api/bookings.js'
import { useReveal } from '../hooks/useReveal.js'

const inputStyle = {
  width: '100%',
  padding: '14px 16px',
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: 10,
  color: 'var(--text)',
  fontSize: 15,
  fontFamily: 'inherit',
}

// Preserved verbatim from the original form (M2 — swaps to GET /services later)
const SERVICE_OPTIONS = [
  'General Service',
  'Vehicle Diagnostics',
  'Engine Repair',
  'Brakes',
  'Suspension',
  'AC & Cooling',
  'Auto Electrical',
  'Not sure — please diagnose',
]

export default function ContactPage() {
  const ref = useReveal()
  const { garage } = useContentOrStatic()
  const [form, setForm] = useState({
    name: '',
    phone: '',
    vehicleText: '',
    serviceName: 'General Service',
    message: '',
  })
  // idle | submitting | success | error
  const [submitState, setSubmitState] = useState('idle')
  const [result, setResult] = useState(null)
  const [errorInfo, setErrorInfo] = useState(null)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitState('submitting')
    setErrorInfo(null)
    try {
      const data = await submitQuoteRequest({
        name: form.name,
        phone: form.phone,
        vehicleText: form.vehicleText || undefined,
        serviceName: form.serviceName,
        message: form.message || undefined,
      })
      setResult(data)
      setSubmitState('success')
    } catch (err) {
      setErrorInfo({
        code: err?.code ?? 'UNKNOWN',
        message: err?.message ?? 'Something went wrong. Please try again.',
      })
      setSubmitState('error')
    }
  }

  function resetForm() {
    setSubmitState('idle')
    setResult(null)
    setErrorInfo(null)
  }

  return (
    <>
      <PageHero
        kicker="Contact"
        title={
          <>
            Book a service, <span style={{ color: 'var(--accent)' }}>get a quote.</span>
          </>
        }
        sub="Call, WhatsApp or send the form — we respond within one working hour during opening times."
        image="https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1600&q=70"
      />

      <section className="section" ref={ref}>
        <div className="container">
          <div className="split-2" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 48 }}>
            {/* Form */}
            <div data-reveal>
              {submitState === 'success' ? (
                <div
                  style={{
                    padding: 40,
                    border: '1px solid var(--accent-dim)',
                    background: 'var(--accent-dim)',
                    borderRadius: 'var(--radius)',
                    textAlign: 'center',
                  }}
                >
                  <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icons.check(40)}</span>
                  <h2 style={{ fontSize: 26, marginTop: 16 }}>Request received</h2>
                  <p style={{ color: 'var(--muted)', marginTop: 10 }}>
                    Your booking reference is{' '}
                    <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                      {result?.bookingNumber}
                    </strong>
                    . We will call you back within one working hour to confirm your slot.
                    For anything urgent, WhatsApp us directly.
                  </p>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 22 }}>
                    <a href={garage.whatsapp} target="_blank" rel="noreferrer" className="btn btn-wa">
                      {icons.whatsapp(18)} WhatsApp Us
                    </a>
                    <button type="button" onClick={resetForm} className="btn btn-ghost">
                      Make Another Request
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onSubmit} style={{ display: 'grid', gap: 18 }}>
                  <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                    <label style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                      Your Name
                      <input
                        required
                        minLength={2}
                        maxLength={120}
                        placeholder="e.g. Brian M."
                        value={form.name}
                        onChange={set('name')}
                        style={inputStyle}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                      Phone / WhatsApp
                      <input
                        required
                        type="tel"
                        placeholder="+254 7XX XXX XXX"
                        value={form.phone}
                        onChange={set('phone')}
                        style={inputStyle}
                      />
                    </label>
                  </div>

                  <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                    <label style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                      Vehicle (Make &amp; Model)
                      <input
                        placeholder="e.g. Toyota Fielder 2016"
                        maxLength={120}
                        value={form.vehicleText}
                        onChange={set('vehicleText')}
                        style={inputStyle}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                      Service Needed
                      <select value={form.serviceName} onChange={set('serviceName')} style={inputStyle}>
                        {SERVICE_OPTIONS.map((opt) => (
                          <option key={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                    Describe the issue
                    <textarea
                      rows={5}
                      placeholder="Any sounds, warning lights, or when it started…"
                      maxLength={2000}
                      value={form.message}
                      onChange={set('message')}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </label>

                  {submitState === 'error' && (
                    <div
                      role="alert"
                      style={{
                        padding: '14px 18px',
                        border: '1px solid rgba(255, 90, 70, 0.4)',
                        background: 'rgba(255, 90, 70, 0.08)',
                        borderRadius: 10,
                        fontSize: 14.5,
                      }}
                    >
                      <strong style={{ color: '#ff7a5a' }}>Request failed.</strong>{' '}
                      <span style={{ color: 'var(--muted)' }}>{errorInfo?.message}</span>
                      {errorInfo?.code === 'NETWORK_ERROR' && (
                        <div style={{ color: 'var(--faint)', fontSize: 13, marginTop: 6 }}>
                          You can also reach us on WhatsApp or by phone while the connection is restored.
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn btn-accent"
                    disabled={submitState === 'submitting'}
                    style={{
                      justifySelf: 'start',
                      opacity: submitState === 'submitting' ? 0.7 : 1,
                      cursor: submitState === 'submitting' ? 'wait' : 'pointer',
                    }}
                  >
                    {submitState === 'submitting' ? 'Sending…' : (
                      <>
                        Request Booking {icons.arrow(18)}
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            {/* Info column */}
            <div data-reveal style={{ '--reveal-delay': '120ms', display: 'grid', gap: 18, alignContent: 'start' }}>
              <div style={{ padding: '26px 28px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)' }}>{icons.phone(18)}</span> Call us
                </h3>
                <a href={garage.phoneHref} style={{ display: 'inline-block', marginTop: 8, color: 'var(--muted)' }}>{garage.phone}</a>
              </div>

              <div style={{ padding: '26px 28px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)' }}>{icons.whatsapp(18)}</span> WhatsApp
                </h3>
                <a href={garage.whatsapp} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: 'var(--muted)' }}>
                  Chat with the workshop →
                </a>
              </div>

              <div style={{ padding: '26px 28px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)' }}>{icons.clock(18)}</span> Opening hours
                </h3>
                <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 14.5 }}>
                  {garage.hours.map((h) => (
                    <div key={h.days} style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                      <span>{h.days}</span>
                      <span>{h.time}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ padding: '26px 28px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
                <h3 style={{ fontSize: 17, fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)' }}>{icons.mail(18)}</span> Email
                </h3>
                <a href={`mailto:${garage.email}`} style={{ display: 'inline-block', marginTop: 8, color: 'var(--muted)' }}>{garage.email}</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
