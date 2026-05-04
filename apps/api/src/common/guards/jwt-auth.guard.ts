import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS, UserRole } from '@prime-tracker/shared';

const VALID_DEMO_ROLES: string[] = [
  'SUPER_ADMIN', 'FOUNDER', 'EXECUTIVE', 'FINANCE', 'ACCOUNTING', 'AR_AP',
  'PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING', 'LEGAL', 'VIEWER',
];

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

    // Demo mode: bypass real Supabase JWT verification for `Bearer demo-<ROLE>`.
    // Gated behind DEMO_MODE=true env (NOT NODE_ENV) so it can never accidentally
    // activate in a real deployment unless explicitly opted in.
    if (process.env.DEMO_MODE === 'true') {
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
