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
    if (!payload.email) {
      throw new UnauthorizedException('Token missing email claim');
    }

    // Lookup app user by email — roles and permissions live in our User table.
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
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
