import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLE_PERMISSIONS, UserRole } from '@prime-tracker/shared';

// Supabase JWT payload (HS256, signed with project's JWT secret).
// Standard claims: sub (Supabase user UUID), email, role ('authenticated'),
// aud ('authenticated'), exp, iat, iss.
interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  aud?: string;
  role?: string;
  exp?: number;
  iat?: number;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
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
      secretOrKey: config.getOrThrow('SUPABASE_JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: SupabaseJwtPayload) {
    if (!payload.email) {
      throw new UnauthorizedException('Token missing email claim');
    }

    // Lookup app user by email — Supabase only handles auth, app roles live in our User table.
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not whitelisted or deactivated');
    }

    const role = user.role as UserRole;
    return {
      sub: user.id,
      email: user.email,
      role,
      permissions: ROLE_PERMISSIONS[role] ?? [],
      mfaVerified: false,
      supabaseId: payload.sub,
    };
  }
}
