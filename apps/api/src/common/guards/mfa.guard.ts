import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_REQUIRED_KEY } from '../decorators/index';

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
      throw new ForbiddenException(
        'MFA verification required for this action. Please verify your TOTP code.',
      );
    }

    return true;
  }
}
