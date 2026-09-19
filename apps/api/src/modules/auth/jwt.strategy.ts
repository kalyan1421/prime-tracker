import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLE_PERMISSIONS, UserRole } from '@prime-tracker/shared';

interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  permissions?: string[];
  mfaVerified?: boolean;
  exp?: number;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Token missing subject claim');
    }

    // Lookup by `sub` (the immutable User.id), NOT by email.
    //
    // This used to resolve `where: { email: payload.email }`, which made the account a
    // token maps to whatever row currently owns that address rather than the user the token
    // was issued to. Email is mutable — PUT /users/:id exposes it via UpdateUserDto — so a
    // rename-and-rehire (change A's address, create a new user with A's old one) silently
    // re-pointed A's outstanding 15-minute token at the new account and its permissions,
    // and the reverse case 401'd live sessions for no visible reason.
    //
    // Every token this app issues carries `sub` (AuthService.generateTokens), and the row is
    // re-read on every request either way, so there is nothing to migrate: an in-flight
    // token keeps working, it just resolves by id now.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not whitelisted or deactivated');
    }

    const roles = (user.roles?.length ? user.roles : [user.role]) as UserRole[];
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      roles,
      permissions: [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))],
      // Sign-in method, re-read each request so linking Google or setting a password
      // is reflected without a re-login. Booleans only — never the hash.
      hasPassword: !!user.passwordHash,
      googleLinked: !!user.googleId,
      mfaVerified: payload.mfaVerified ?? false,
    };
  }
}
