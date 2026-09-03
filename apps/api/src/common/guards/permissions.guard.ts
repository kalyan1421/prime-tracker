import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ANY_PERMISSIONS_KEY } from '../decorators/index';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const anyPermissions = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const needsAll = !!requiredPermissions?.length;
    const needsAny = !!anyPermissions?.length;
    if (!needsAll && !needsAny) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.permissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (needsAll) {
      const missing = requiredPermissions.filter((p) => !user.permissions.includes(p));
      if (missing.length) {
        throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
      }
    }

    // ANY-of is checked independently of ALL-of, so a route may carry both: the ALL list
    // is the floor everyone must clear, the ANY list is the "one of these will do" case.
    if (needsAny && !anyPermissions.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(
        `Missing permissions: one of ${anyPermissions.join(' or ')}`,
      );
    }

    return true;
  }
}
