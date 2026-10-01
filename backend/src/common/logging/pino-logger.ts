import pino from 'pino'
import { getRequestContext } from '../context/request-context'
import type { Env } from '../../config/env.schema'

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'passwordHash',
  '*.password',
  'newPassword',
  'currentPassword',
  'mpesa.passkey',
  '*.token',
  'refreshToken',
  'accessToken',
]

export function buildPinoLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: REDACT_PATHS,
    base: { service: 'motora-api' },
    mixin() {
      const ctx = getRequestContext()
      return ctx ? { requestId: ctx.requestId } : {}
    },
    ...(env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  })
}

/** Child logger binding the current request id lazily. */
export function reqLog(): pino.Logger {
  const ctx = getRequestContext()
  const base = (globalThis as unknown as { __motoraLogger?: pino.Logger }).__motoraLogger
  const root = base ?? pino({ level: 'info' })
  return ctx ? root.child({ requestId: ctx.requestId }) : root
}
