import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS, UserRole } from '@prime-tracker/shared';

const VALID_DEMO_ROLES: string[] = [
  'SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP',
  'PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL', 'VIEWER',
];

/**
 * Whether `Bearer demo-<ROLE>` is honoured. BOTH must hold: DEMO_MODE=true, and NODE_ENV
 * set to exactly 'development'.
 *
 * It used to need only DEMO_MODE, with main.ts refusing to boot on NODE_ENV=production.
 * That left every other environment open: NODE_ENV unset (pm2 starting dist/main.js
 * without the .env, as main.ts records happening on the live box), 'staging', 'test', a
 * typo — any of them plus a stray DEMO_MODE=true meant `Bearer demo-SUPER_ADMIN` was full
 * administrative access with no credential at all. Requiring the one value only a
 * developer's machine has makes the bypass fail closed everywhere else. The production
 * boot check in main.ts stays as a louder second line.
 *
 * Read per request from process.env, which ConfigModule has populated from .env by the
 * time any request arrives.
 */
export function isDemoModeActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === 'true' && env.NODE_ENV === 'development';
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Demo mode: bypass real JWT verification for `Bearer demo-<ROLE>`.
    if (isDemoModeActive()) {
      const request = context.switchToHttp().getRequest();
      const auth = request.headers.authorization as string | undefined;
      if (auth?.startsWith('Bearer demo-')) {
        const rolePart = auth.replace('Bearer demo-', '').toUpperCase();
        if (VALID_DEMO_ROLES.includes(rolePart)) {
          const role = rolePart as UserRole;
          request.user = {
            sub: `demo-user-${rolePart.toLowerCase()}`,
            email: `demo-${rolePart.toLowerCase()}@primedevelopers.com`,
            role,
            permissions: ROLE_PERMISSIONS[role] || [],
            mfaVerified: false,
          };
          return true;
        }
      }
    }

    return super.canActivate(context);
  }
}
