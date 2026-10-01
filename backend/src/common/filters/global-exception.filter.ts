import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { ZodError } from 'zod'
import { ApiError, ErrorCodes } from '../errors/error-codes'
import { getRequestContext } from '../context/request-context'

/**
 * Centralized exception handling (Spec §49). Maps every failure to:
 *   { success:false, error:{ code, message, requestId, details? } }
 * Internal errors are logged server-side but never leaked to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    const ctx = getRequestContext()
    const requestId = ctx?.requestId ?? 'unknown'

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code: string = ErrorCodes.INTERNAL_ERROR
    let message = 'Something went wrong. Please try again.'
    let details: unknown

    if (exception instanceof ApiError) {
      status = exception.httpStatus
      code = exception.code
      message = exception.message
      details = exception.details
      if (status >= 500) {
        this.logger.error({ err: exception }, 'ApiError(5xx)')
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST
      code = ErrorCodes.VALIDATION_ERROR
      message = 'Validation failed.'
      details = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') {
        message = body
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>
        message = typeof b.message === 'string' ? b.message : Array.isArray(b.message) ? b.message.join('; ') : exception.message
        if (Array.isArray(b.message)) details = b.message
      }
      code =
        status === 401
          ? ErrorCodes.UNAUTHORIZED
          : status === 403
            ? ErrorCodes.FORBIDDEN
            : status === 404
              ? ErrorCodes.NOT_FOUND
          : status === 429
            ? ErrorCodes.RATE_LIMITED
            : code
    } else {
      // Unknown/unexpected — log fully, return safely.
      this.logger.error(
        { err: exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception },
        'Unhandled exception',
      )
    }

    if (res.headersSent) {
      return
    }

    res.status(status).json({
      success: false,
      error: {
        code,
        message,
        requestId,
        ...(details !== undefined ? { details } : {}),
      },
    })
  }
}
