import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchGarage, fetchServices, fetchTestimonials, fetchGalleryItems } from './content.js'
import {
  garageFallback,
  servicesFallback,
  extrasFallback,
  testimonialsFallback,
  worksFallback,
  brands,
} from './fallbacks.js'

/**
 * Loads all public content from the backend once, maps it to the exact
 * shapes in src/data/*, and exposes it via useContentOrStatic(). If the
 * backend is unreachable, falls back to the original static data so the
 * public site still renders (offline-first for marketing content).
 */
const ContentContext = createContext({ status: 'loading' })

/** Builds the wa.me deep link with the original prefilled message. */
export function buildWhatsappUrl(number, text = "Hi MOTORA, I'd like to book a service.") {
  const digits = String(number ?? '').replace(/\D+/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

export function ContentProvider({ children }) {
  const [state, setState] = useState({ status: 'loading' })
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false // reset after StrictMode's mount/unmount/mount cycle
    load()
    return () => {
      cancelled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    try {
      const [garage, servicesRes, testimonialsRes, galleryRes] = await Promise.all([
        fetchGarage(),
        fetchServices({ limit: 50 }),
        fetchTestimonials({ limit: 20 }),
        fetchGalleryItems({ limit: 50 }),
      ])

      const content = {
        garage: { ...garageFallback, ...garage }, // live values win; static fills UI-only fields
        services: servicesRes.items.filter((s) => s.category === 'CORE'),
        extras: servicesRes.items.filter((s) => s.category === 'EXTRA'),
        testimonials: testimonialsRes.items,
        works: galleryRes.items,
      }

      if (!cancelled.current) setState({ status: 'ready', content, error: null })
    } catch (err) {
      if (!cancelled.current) {
        setState({ status: 'fallback', content: null, error: err?.code ?? 'UNKNOWN' })
      }
    }
  }

  const value = useMemo(() => state, [state])
  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>
}

export function useContent() {
  return useContext(ContentContext)
}

/**
 * Live content when available; the original static data otherwise
 * (including during initial load, so first paint matches the
 * pre-integration site exactly).
 */
export function useContentOrStatic() {
  const { status, content } = useContent()
  if (status === 'ready' && content) {
    return {
      status,
      ...content,
      garage: {
        ...content.garage,
        // Components use garage.whatsapp (deep link) exactly like site.whatsapp before
        whatsapp:
          content.garage.whatsapp ??
          buildWhatsappUrl(content.garage.whatsappNumber ?? content.garage.phone),
      },
    }
  }
  return {
    status,
    garage: { ...garageFallback, brands }, // site lacks brands — fill from data/brands.js
    services: servicesFallback,
    extras: extrasFallback,
    testimonials: testimonialsFallback,
    works: worksFallback,
  }
}
