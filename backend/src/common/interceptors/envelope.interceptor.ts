import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { map, Observable } from 'rxjs'
import { getRequestContext } from '../context/request-context'

export interface Envelope<T> {
  success: true
  data: T
  meta?: Record<string, unknown>
}

/**
 * Wraps successful responses in the standard envelope (Spec §31).
 * Controllers return plain payloads; the envelope is applied here.
 */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    return next.handle().pipe(
      map((data) => {
        const reqCtx = getRequestContext()
        if (data && typeof data === 'object' && 'success' in (data as Record<string, unknown>)) {
          return data as unknown as Envelope<T> // passthrough (e.g. health checks)
        }
        const meta = reqCtx ? { requestId: reqCtx.requestId } : {}
        return { success: true as const, data, meta }
      }),
    )
  }
}
