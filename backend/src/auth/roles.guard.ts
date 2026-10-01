import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiError } from '../common/errors/error-codes'
import { ROLE_RANK } from './auth.service'

export const ROLES_KEY = 'motora:roles'

/**
 * Declares the roles allowed on a route. Either a minimum rank via "X+"
 * (e.g. @Roles('SERVICE_ADVISOR+') → SERVICE_ADVISOR and above) or an
 * explicit role list (e.g. @Roles('CASHIER', 'ADMIN')).
 */
export function Roles(...roles: string[]) {
  return SetMetadata(ROLES_KEY, roles)
}

/**
 * Role-based access control (Spec §26). Two modes per @Roles():
 *   - "ROLE+" strings act as a minimum-rank gate using ROLE_RANK.
 *   - Plain strings require an exact role (OR semantics across entries).
 * A route without @Roles() is open to any authenticated caller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const req = context.switchToHttp().getRequest<{ user?: { role?: string } }>()
    const role = req.user?.role
    if (!role) throw ApiError.forbidden('Your role does not have access to this resource.')

    for (const entry of required) {
      if (entry.endsWith('+')) {
        const min = ROLE_RANK[entry.slice(0, -1)]
        if (min !== undefined && (ROLE_RANK[role] ?? 0) >= min) return true
      } else if (entry === role) {
        return true
      }
    }

    throw ApiError.forbidden('Your role does not have access to this resource.')
  }
}
