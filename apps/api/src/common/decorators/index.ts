import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

// ---- Permission-based access ----
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

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
