import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../common/utils/audit.service';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { ROLE_PERMISSIONS, UserRole } from '@prime-tracker/shared';
import { randomBytes } from 'crypto';

interface GoogleProfile {
  id: string;
  email: string;
  displayName: string;
  picture?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private encryption: EncryptionService,
    private audit: AuditService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async loginWithPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      metadata: { provider: 'password' },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role as UserRole, false);
    const permissions = ROLE_PERMISSIONS[user.role as UserRole] || [];

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        permissions,
        mfaEnabled: user.mfaEnabled,
        mfaVerified: false,
      },
    };
  }

  async validateGoogleUser(profile: GoogleProfile): Promise<TokenPair> {
    const allowedDomain = this.config.get('GOOGLE_ALLOWED_DOMAIN');

    // Enforce domain restriction for Workspace SSO
    if (allowedDomain) {
      const emailDomain = profile.email.split('@')[1];
      if (emailDomain !== allowedDomain) {
        throw new ForbiddenException(
          `Only @${allowedDomain} accounts are allowed`,
        );
      }
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.displayName,
          googleId: profile.id,
          avatarUrl: profile.picture,
          role: 'VIEWER', // default role; founders can upgrade
        },
      });
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.id, avatarUrl: profile.picture },
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      metadata: { provider: 'google' },
    });

    return this.generateTokens(user.id, user.email, user.role as UserRole, false);
  }

  async generateTokens(
    userId: string,
    email: string,
    role: UserRole,
    mfaVerified: boolean,
  ): Promise<TokenPair> {
    const permissions = ROLE_PERMISSIONS[role] || [];

    const payload = {
      sub: userId,
      email,
      role,
      permissions,
      mfaVerified,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRY', '15m'),
    });

    const refreshTokenValue = randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Store refresh token (rotate: revoke old ones)
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: 900, // 15 min in seconds
    };
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke old token
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role as UserRole,
      false,
    );
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId },
        data: { revokedAt: new Date() },
      });
    } else {
      // Revoke all sessions
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.log({
      userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: userId,
    });
  }

  // ---- MFA (TOTP) ----

  async setupMfa(userId: string): Promise<{ secret: string; qrCodeUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const secret = authenticator.generateSecret();
    const issuer = this.config.get('TOTP_ISSUER', 'PrimeTracker');
    const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Store encrypted secret (not yet enabled)
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: this.encryption.encrypt(secret) },
    });

    return { secret, qrCodeUrl };
  }

  async enableMfa(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.mfaSecret) {
      throw new BadRequestException('MFA not set up. Call setup first.');
    }

    const decryptedSecret = this.encryption.decrypt(user.mfaSecret);
    const isValid = authenticator.verify({ token, secret: decryptedSecret });

    if (!isValid) {
      throw new BadRequestException('Invalid TOTP code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    await this.audit.log({
      userId,
      action: 'MFA_VERIFY',
      entity: 'User',
      entityId: userId,
      metadata: { action: 'enabled' },
    });

    return true;
  }

  async verifyMfa(userId: string, token: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('MFA not enabled for this user');
    }

    const decryptedSecret = this.encryption.decrypt(user.mfaSecret);
    const isValid = authenticator.verify({ token, secret: decryptedSecret });

    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.audit.log({
      userId,
      action: 'MFA_VERIFY',
      entity: 'User',
      entityId: userId,
    });

    // Issue new tokens with mfaVerified = true
    return this.generateTokens(user.id, user.email, user.role as UserRole, true);
  }
}
