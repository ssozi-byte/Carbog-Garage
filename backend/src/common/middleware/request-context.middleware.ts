import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { createRequestContext, runWithRequestContext } from '../context/request-context'

@Injectable()
export class RequestCtxMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const ctx = createRequestContext(req.method, req.originalUrl)
    res.setHeader('X-Request-Id', ctx.requestId)
    runWithRequestContext(ctx, () => next())
    // ALS context propagates through the async chain of this request
  }
}
