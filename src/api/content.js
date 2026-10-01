/**
 * Public content fetchers — map backend DTOs to the exact shapes the
 * existing UI consumes (src/data/*), so components need no redesign.
 */
import { api } from './client.js'

/** Formats +254712345678 → "+254 712 345 678" for display (tel: uses raw). */
function formatPhone(raw) {
  const digits = String(raw ?? '').replace(/\D+/g, '')
  if (digits.length < 12) return raw
  return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
}

function mapGarage(dto) {
  return {
    name: dto.name,
    slug: dto.slug,
    phone: formatPhone(dto.phone),
    whatsappNumber: dto.whatsappNumber,
    phoneHref: `tel:${dto.phone.replace(/\s+/g, '')}`,
    email: dto.email,
    location: {
      area: dto.area,
      city: dto.city,
      county: dto.county,
      address: dto.address,
      directions: dto.directionsUrl,
    },
    // Backend returns 7 day-slots; convert to the UI's label/time rows.
    hours: mapHours(dto.hours ?? []),
    socials: dto.socials ?? [],
    brands: dto.brandsServiced ?? [],
    stats: dto.stats ?? [],
  }
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER = Object.fromEntries(DAY_LABELS.map((d, i) => [d, i === 0 ? 7 : i])) // Sun sorts last

function fmtTime(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  const h = t.getUTCHours()
  const m = t.getUTCMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function mapHours(slots) {
  // Group per-day rows with identical hours into the UI's range format
  // ("Monday – Friday"), preserving the original three-row layout.
  const byTime = new Map()
  for (const h of slots) {
    if (h.isClosed) continue
    const label = DAY_LABELS[h.dayOfWeek]
    if (!label) continue
    const time = `${fmtTime(h.opensAt)} – ${fmtTime(h.closesAt)}`
    if (!byTime.has(time)) byTime.set(time, [])
    byTime.get(time).push(label)
  }

  const rows = [...byTime.entries()].map(([time, days]) => {
    if (days.length === 1) return { days: days[0], time }
    const sorted = days.sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b])
    return { days: `${sorted[0]} – ${sorted[sorted.length - 1]}`, time }
  })

  if (slots.some((h) => h.isClosed)) rows.push({ days: 'Sunday', time: 'Closed' })
  return rows
}

function mapService(dto) {
  return {
    id: dto.id,
    slug: dto.slug,
    num: dto.displayNum ?? '',
    title: dto.name,
    blurb: dto.description ?? '',
    icon: dto.iconKey ?? 'wrench',
    points: dto.points ?? [],
    category: dto.category,
    basePrice: dto.basePrice,
    currency: dto.currency,
  }
}

function mapTestimonial(dto) {
  return {
    id: dto.id,
    name: dto.authorName,
    area: dto.authorArea ?? '',
    vehicle: dto.vehicle ?? '',
    rating: dto.rating,
    quote: dto.quote,
    featured: dto.isFeatured,
  }
}

// Backend enum → the display labels the UI has always shown
const TAG_LABELS = {
  ENGINE: 'Engine',
  BRAKES: 'Brakes',
  SUSPENSION: 'Suspension',
  DIAGNOSTICS: 'Diagnostics',
  AC_COOLING: 'AC & Cooling',
  ELECTRICAL: 'Electrical',
  OTHER: 'Other',
}

function mapGalleryItem(dto) {
  return {
    id: dto.id,
    title: dto.title,
    vehicle: dto.vehicleLabel ?? '',
    img: dto.imageUrl,
    tag: TAG_LABELS[dto.tag] ?? dto.tag,
    videoUrl: dto.videoUrl,
  }
}

export async function fetchGarage() {
  const dto = await api.get('/garages/public/current')
  return mapGarage(dto)
}

export async function fetchServices({ page = 1, limit = 50, category } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (category) params.set('category', category)
  const res = await api.get(`/services?${params}`)
  return {
    items: res.items.map(mapService),
    total: res.meta?.total ?? res.items.length,
  }
}

export async function fetchTestimonials({ page = 1, limit = 20, featured } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (featured !== undefined) params.set('featured', String(featured))
  const res = await api.get(`/testimonials?${params}`)
  return {
    items: res.items.map(mapTestimonial),
    total: res.meta?.total ?? res.items.length,
  }
}

export async function fetchGalleryItems({ page = 1, limit = 50, tag } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (tag) params.set('tag', tag)
  const res = await api.get(`/gallery-items?${params}`)
  return {
    items: res.items.map(mapGalleryItem),
    total: res.meta?.total ?? res.items.length,
  }
}
