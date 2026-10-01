/**
 * Bookings API — guest quote request (Spec §43).
 * The backend is the authority: it validates the phone, resolves the
 * service, generates the booking number and de-duplicates re-submissions.
 */
import { api, ApiError } from './client.js'

/**
 * @param {{ name: string, phone: string, vehicleText?: string, serviceName?: string, message?: string }} payload
 * @returns {Promise<{ bookingNumber: string, status: string }>}
 */
export async function submitQuoteRequest(payload) {
  try {
    return await api.post('/bookings/quote-request', payload)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
      throw new ApiError('RATE_LIMITED', 'Too many requests from your network. Please call or WhatsApp us instead — we\u2019ll sort you out.', {
        status: 429,
      })
    }
    throw err
  }
}
