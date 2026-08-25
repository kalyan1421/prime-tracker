import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_REQUIRED_KEY } from '../decorators/index';
import { MFA_REQUIRED_MESSAGE } from '@prime-tracker/shared';

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const mfaRequired = this.reflector.getAllAndOverride<boolean>(
      MFA_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!mfaRequired) return true;

    const { user } = context.switchToHttp().getRequest();

    if (!user?.mfaVerified) {
      // Exact string, shared with the web client — it matches on this to decide
      // whether to open the step-up modal rather than surface a bare 403.
      throw new ForbiddenException(MFA_REQUIRED_MESSAGE);
    }

    return true;
  }
}
