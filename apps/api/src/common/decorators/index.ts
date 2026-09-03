import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

// ---- Permission-based access ----
export const PERMISSIONS_KEY = 'permissions';
/** Requires ALL of the listed permissions. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';
/**
 * Requires ANY ONE of the listed permissions.
 *
 * For endpoints that serve the same data to two audiences holding different permissions —
 * e.g. the interior/TI report, which Finance reaches through `financial:view` and a
 * PROJECT_MANAGER through `interior:finance`. Expressing that as RequirePermissions would
 * demand both and lock out each audience on the other's permission.
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

// ---- MFA step-up requirement ----
export const MFA_REQUIRED_KEY = 'mfa_required';
export const RequireMfa = () => SetMetadata(MFA_REQUIRED_KEY, true);

// ---- Extract current user from request ----
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
