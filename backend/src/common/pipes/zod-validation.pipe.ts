import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { z } from 'zod'
import { ApiError } from '../errors/error-codes'

/**
 * Server-side validation for every incoming body (Spec §32).
 * Usage: @Body(new ZodValidationPipe(schema)) — never trust the client.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: z.ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw ApiError.validation('Validation failed.', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    return result.data
  }
}
