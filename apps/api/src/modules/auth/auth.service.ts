import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../common/utils/audit.service';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
// otplib defaults to window: 0 (zero tolerance), which rejects a correct code
// whenever the client's clock is a few seconds ahead/behind the 30s TOTP step
// boundary. window: 1 accepts the adjacent step either side — standard TOTP
// practice — without weakening the code itself (still a fresh 6-digit guess).
authenticator.options = { window: 1 };
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

  /**
   * Self-service password change. Requires the CURRENT password even though the caller
   * is already authenticated — an unattended session must not be enough to take over
   * the account.
   *
   * On success every other refresh token is revoked, so a stolen session dies with the
   * password change. The caller's own access token stays valid until it expires (15m);
   * revoking it would log the user out of the tab they just used, which teaches people
   * to avoid changing passwords.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    // Google-SSO accounts have no local password. Say so plainly instead of failing
    // an impossible bcrypt.compare against null.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account signs in with Google — there is no password to change.',
      );
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must be different from the current one');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true, sessionsRevoked: revoked.count };
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

    const effectiveRoles = (user.roles?.length ? user.roles : [user.role]) as UserRole[];
    const permissions = [...new Set(effectiveRoles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
    const tokens = await this.generateTokens(user.id, user.email, user.role as UserRole, false);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        roles: effectiveRoles,
        // How this person signs in, so the profile can say so and hide the password
        // form from Google-only accounts. Booleans only — the hash never leaves here.
        hasPassword: !!user.passwordHash,
        googleLinked: !!user.googleId,
        permissions,
        mfaEnabled: user.mfaEnabled,
        mfaVerified: false,
      },
    };
  }

  async validateGoogleUser(profile: GoogleProfile) {
    // Comma-separated, because the staff genuinely span two domains: 31 people on
    // theprimedeveloper.com and 4 on primedevelopers.com. A single exact-match value
    // cannot admit both, and whichever one is configured silently rejects everybody on
    // the other with "Only @x accounts are allowed" — a 403 that looks like a
    // permissions bug rather than a config one. A single domain still works unchanged.
    const allowedDomains = (this.config.get<string>('GOOGLE_ALLOWED_DOMAIN') ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    const emailDomain = (profile.email.split('@')[1] ?? '').toLowerCase();

    let user = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });

    // The gate governs SELF-PROVISIONING, not sign-in.
    //
    // It used to run before the lookup, which conflated two different questions: "may
    // this person sign in" and "may this person create themselves an account". That
    // forced an impossible choice for the handful of staff on personal addresses —
    // either lock them out, or add gmail.com to the list and let ANY Google account on
    // earth provision itself a VIEWER, which carries PROJECT/BUILDING/UNIT/MILESTONE/
    // COMMENT/DAILYLOG view over the WHOLE portfolio.
    //
    // Splitting it resolves both: an account that already exists may sign in from any
    // domain, because a human deliberately created it. Only the configured domains may
    // bring a NEW account into existence.
    if (!user && !allowedDomains.includes(emailDomain)) {
      throw new ForbiddenException(
        allowedDomains.length > 0
          ? `No account exists for ${profile.email}. Ask an administrator to create one, ` +
            `or sign in with a ${allowedDomains.map((d) => `@${d}`).join(' or ')} address.`
          : `No account exists for ${profile.email}.`,
      );
    }

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

    const effectiveRoles2 = (user.roles?.length ? user.roles : [user.role]) as UserRole[];
    const permissions2 = [...new Set(effectiveRoles2.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
    const tokens2 = await this.generateTokens(user.id, user.email, user.role as UserRole, false);

    return {
      ...tokens2,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        role: user.role,
        roles: effectiveRoles2,
        hasPassword: !!user.passwordHash,
        googleLinked: !!user.googleId,
        permissions: permissions2,
        mfaEnabled: user.mfaEnabled,
        mfaVerified: false,
      },
    };
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

  /** Requires a current TOTP code, not the password — the point of MFA is that
   *  possessing the authenticator is a separate proof from the password, so giving
   *  it up should require the same proof, not the weaker one it was meant to add. */
  async disableMfa(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }

    const decryptedSecret = this.encryption.decrypt(user.mfaSecret);
    const isValid = authenticator.verify({ token, secret: decryptedSecret });

    if (!isValid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });

    await this.audit.log({
      userId,
      action: 'MFA_VERIFY',
      entity: 'User',
      entityId: userId,
      metadata: { action: 'disabled' },
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
