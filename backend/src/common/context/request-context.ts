import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export interface RequestUser {
  id: string
  role: string
  garageId: string | null
}

export interface RequestContext {
  requestId: string
  method: string
  path: string
  startedAt: number
  user?: RequestUser
  garageId?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

export function createRequestContext(method: string, path: string): RequestContext {
  return {
    requestId: randomUUID(),
    method,
    path,
    startedAt: Date.now(),
  }
}

/** Sets/overrides user in the current context (auth middleware, guards). */
export function setRequestUser(user: RequestUser): void {
  const ctx = storage.getStore()
  if (ctx) {
    ctx.user = user
    ctx.garageId = user.garageId ?? undefined
    ;(ctx as RequestContext & { user?: RequestUser }).user = user
  }
}
