/**
 * Centralized API client (Spec §54) — the ONLY place that talks to the backend.
 * Components never call fetch directly.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
const DEFAULT_TIMEOUT = 10_000

export class ApiError extends Error {
  constructor(code, message, { status = 0, requestId, details } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.details = details
  }
}

async function request(path, { method = 'GET', body, signal, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const effectiveSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: effectiveSignal,
    })

    let json = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON error body */
    }

    if (!res.ok) {
      const err = json?.error ?? {}
      throw new ApiError(err.code ?? 'UNKNOWN', err.message ?? `Request failed (${res.status})`, {
        status: res.status,
        requestId: err.requestId,
        details: err.details,
      })
    }

    if (json && typeof json === 'object' && 'success' in json) {
      return json.data
    }
    return json
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Request timed out.', { status: 0 })
    }
    // Network failure / backend down — don't log as error, just throw for graceful fallback
    throw new ApiError('NETWORK_ERROR', 'Backend unreachable.', { status: 0 })
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
}
