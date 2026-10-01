/**
 * Fallback content = the original src/data/* modules, unchanged.
 * The public site renders identically when the backend is unreachable.
 */
import { site, nav, stats } from '../data/site.js'
import { services as servicesFallback, extras as extrasFallback } from '../data/services.js'
import { testimonials as testimonialsFallback, values } from '../data/testimonials.js'
import { brands, works as worksFallback } from '../data/brands.js'

// site.js exports stats as a sibling of site — merge into the garage shape
// the UI consumes (garage.stats), matching the API's mapped shape.
export const garageFallback = { ...site, stats }

export { nav, servicesFallback, extrasFallback, testimonialsFallback, values, brands, worksFallback }
