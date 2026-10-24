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
import { createHash, randomBytes } from 'crypto';

export interface GoogleProfile {
  id: string;
  email: string;
  /** Google's own `email_verified` claim. Unverified addresses never sign anyone in. */
  emailVerified: boolean;
  displayName: string;
  picture?: string;
}

/** Where a sign-in attempt came from, for the audit row. Both optional — never trusted. */
export interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid or expired refresh token';

/** Ten wrong passwords in a row lock the account for fifteen minutes. The per-IP throttle
 *  (20/min on /auth/login) cannot do this on its own: it starts afresh for every new
 *  address, and a guessing run against one account can come from as many as it likes. */
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

const REFRESH_TOKEN_TTL_DAYS = 7;

/**
 * How long after a refresh token is rotated a second presentation of it is treated as a
 * race rather than theft.
 *
 * Two tabs of the web app share one refresh token through localStorage, and both see the
 * access token expire at the same moment — a laptop waking up refetches in every tab at
 * once. Both send the same refresh token within a round trip of each other; one wins the
 * rotation and the other arrives holding a token revoked milliseconds earlier. Treating
 * that as reuse would revoke every session the user has, on every device, every time they
 * open the lid. Inside this window the loser just gets a 401 and picks up the winner's
 * token from storage (lib/api.ts); outside it, a revoked token coming back is what a
 * stolen copy looks like, and every session is ended.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/**
 * A real cost-12 bcrypt hash of a throwaway string, compared against when the email is
 * unknown (or the account has no password). Without it, "no such user" returned before
 * bcrypt ran — a few milliseconds instead of ~250 — so the response time alone said which
 * addresses have accounts. The cost has to match what hashPassword() uses, or the
 * difference just gets smaller rather than going away.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$1TEt2vBlIYW9.fKRHu8nfOCx7BJSsBsNbEiljGbI3sloJWBRxOKF.';

/** Refresh tokens are stored as this, never as themselves (see schema.prisma). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type TotpResult = 'ok' | 'invalid' | 'replayed';
const TOTP_REPLAYED_MESSAGE =
  'That code has already been used. Wait for the next one in your authenticator app.';

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

  async loginWithPassword(email: string, password: string, client: LoginContext = {}) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      // Spend the same bcrypt time a real account would, so timing cannot tell the two
      // apart. The result is irrelevant — this path always fails.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      await this.auditFailedLogin(user?.id, 'password', user ? 'NO_PASSWORD' : 'UNKNOWN_ACCOUNT', client, {
        // The attempted address is the only way to see a spraying run against accounts
        // that do not exist. Capped, since it is caller-controlled.
        email: email.slice(0, 254),
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const now = new Date();

    // A locked account is refused WITHOUT checking the password. Checking it would turn
    // the lock into an oracle ("locked, but that one was right") and let guessing carry
    // on at full speed underneath it.
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.auditFailedLogin(user.id, 'password', 'LOCKED', client);
      throw new ForbiddenException(this.lockedMessage(user.lockedUntil, now));
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const lockedUntil = await this.recordFailedLogin(user.id, now);
      await this.auditFailedLogin(user.id, 'password', 'BAD_PASSWORD', client,
        lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : undefined);
      // The attempt that trips the lock says so, rather than leaving the user to discover
      // it on the next try with the right password.
      if (lockedUntil) throw new ForbiddenException(this.lockedMessage(lockedUntil, now));
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      // A successful sign-in clears the failure count, so ten typos spread over months
      // never add up to a lockout.
      data: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null },
    });

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
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

  async validateGoogleUser(profile: GoogleProfile, client: LoginContext = {}) {
    // Only an address Google itself has verified identifies anyone. Accounts here are
    // matched by email, so an unverified one would let whoever typed it into a Google
    // account — without ever proving they own the mailbox — sign in as the person who does.
    if (!profile.emailVerified) {
      await this.auditFailedLogin(undefined, 'google', 'EMAIL_NOT_VERIFIED', client, {
        email: profile.email?.slice(0, 254),
      });
      throw new ForbiddenException(
        'Google has not verified this email address, so it cannot be used to sign in.',
      );
    }

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
      await this.auditFailedLogin(undefined, 'google', 'DOMAIN_NOT_ALLOWED', client, {
        email: profile.email.slice(0, 254),
      });
      throw new ForbiddenException(
        allowedDomains.length > 0
          ? `No account exists for ${profile.email}. Ask an administrator to create one, ` +
            `or sign in with a ${allowedDomains.map((d) => `@${d}`).join(' or ')} address.`
          : `No account exists for ${profile.email}.`,
      );
    }

    // Once an account is linked, the Google account id — not the address — is what it
    // answers to. Addresses get reassigned (a Workspace admin renames a mailbox, a leaver's
    // address goes to a new hire) and a consumer Google account can be created for any
    // address its owner can verify; the `sub` Google issues is stable and never reused.
    if (user?.googleId && user.googleId !== profile.id) {
      await this.auditFailedLogin(user.id, 'google', 'GOOGLE_ID_MISMATCH', client);
      throw new ForbiddenException(
        'This account is linked to a different Google account. Sign in with that one, ' +
          'or ask an administrator for help.',
      );
    }

    if (user && !user.isActive) {
      await this.auditFailedLogin(user.id, 'google', 'DEACTIVATED', client);
      throw new ForbiddenException('Account is deactivated');
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
      // First Google sign-in for an account an admin created: bind it to this Google
      // account, so the check above holds from now on.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.id, avatarUrl: profile.picture },
      });
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
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
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
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    // Only the hash is stored; the token itself exists in this response and nowhere else.
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(refreshTokenValue),
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: this.lifetimeSeconds(accessToken),
    };
  }

  /**
   * Seconds the access token is valid for, read back from the token itself.
   *
   * This used to be a hardcoded 900 sitting next to a configurable JWT_ACCESS_EXPIRY, so
   * changing the config made the response lie about the token it came with. Reading
   * exp − iat off the signed token cannot disagree with it, whatever format the setting is
   * written in ('15m', '1h', a bare number).
   */
  private lifetimeSeconds(accessToken: string): number {
    const claims = this.jwt.decode(accessToken) as { iat?: number; exp?: number } | null;
    if (typeof claims?.exp !== 'number' || typeof claims?.iat !== 'number') {
      throw new Error('Signed access token is missing its iat/exp claims');
    }
    return claims.exp - claims.iat;
  }

  async refreshTokens(refreshToken: string, client: LoginContext = {}): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const now = new Date();

    if (stored.revokedAt) {
      await this.onRevokedTokenPresented(stored, now, client);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    if (stored.expiresAt < now) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    // Deactivated accounts cannot refresh.
    //
    // This route is public (it must be — the access token is expired by definition), and it
    // used to validate only the token ROW. Every REST route re-checks isActive in
    // jwt.strategy, so a deactivated user could not read data with the result — but
    // notifications.gateway.ts only calls jwtService.verify(), so they could hold a
    // WebSocket open and keep receiving live notifications for the refresh token's full
    // 7-day life by refreshing. Deactivation is the primary offboarding control; it has to
    // end the session, not just the next request. toggleActive() now revokes outstanding
    // tokens too, so this is the second line rather than the only one.
    if (!stored.user.isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('Account is deactivated');
    }

    // Rotate atomically. This used to read the row, check revokedAt, then update by id —
    // two requests carrying the same token both passed the check before either wrote, and
    // both walked away with a fresh token pair: one stolen token became two live sessions.
    // The conditional write lets exactly one of them claim it.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      // Lost the race to a concurrent rotation of the same token, milliseconds ago — the
      // grace case of onRevokedTokenPresented by definition, so no session-wide revocation.
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    return this.generateTokens(
      stored.user.id,
      stored.user.email,
      stored.user.role as UserRole,
      false,
    );
  }

  /**
   * Reuse detection. A refresh token is single-use, so one that comes back after it was
   * spent means two parties hold a copy — and the server cannot tell which is the owner.
   * Ending every session the user has forces both to sign in again, which only the owner
   * can do. Inside REFRESH_REUSE_GRACE_MS it is the two-tabs race instead, and is let go.
   */
  private async onRevokedTokenPresented(
    stored: { id: string; userId: string; revokedAt: Date | null },
    now: Date,
    client: LoginContext,
  ): Promise<void> {
    if (!stored.revokedAt) return;
    if (now.getTime() - stored.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS) return;

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    await this.audit.log({
      userId: stored.userId,
      action: 'REFRESH_TOKEN_REUSE',
      entity: 'User',
      entityId: stored.userId,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        tokenId: stored.id,
        revokedAt: stored.revokedAt.toISOString(),
        sessionsRevoked: revoked.count,
      },
    });
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(refreshToken), userId },
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

  // ---- Login lockout ----

  /**
   * Count one failed password and lock the account if that was one too many. Returns the
   * lock expiry when this attempt tripped it.
   *
   * The increment is a single atomic UPDATE, so concurrent wrong guesses cannot each read
   * the same count and undercount. The counter resets when the lock is applied: after
   * the fifteen minutes the owner gets a full set of attempts again, not one.
   */
  private async recordFailedLogin(userId: string, now: Date): Promise<Date | null> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount < MAX_FAILED_LOGINS) return null;

    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { lockedUntil, failedLoginCount: 0 },
    });
    return lockedUntil;
  }

  /**
   * Sent as a 403, not a 401. The web client treats any 401 as an expired session and
   * goes to refresh/redirect, so the message would never reach the login form; a 403
   * is shown as-is, the same as "Account is deactivated".
   *
   * Saying the account is locked does reveal that it exists — but only to someone who has
   * just spent ten guesses on it, which the audit log records. Leaving the real owner to
   * wonder why their correct password stopped working is the worse trade.
   */
  private lockedMessage(lockedUntil: Date, now: Date): string {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
    return (
      `Too many failed sign-in attempts. This account is locked for ${minutes} more ` +
      `minute${minutes === 1 ? '' : 's'} — try again then, or ask an administrator to reset your password.`
    );
  }

  /** Failed sign-ins are audited like successful ones, so a guessing run is visible. */
  private async auditFailedLogin(
    userId: string | undefined,
    provider: 'password' | 'google',
    reason: string,
    client: LoginContext,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log({
      userId,
      action: 'LOGIN_FAILED',
      entity: 'User',
      entityId: userId,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { provider, reason, ...extra },
    });
  }

  // ---- MFA (TOTP) ----

  /**
   * Refuses when MFA is already on.
   *
   * It used to overwrite mfaSecret unconditionally, which made MFA worth no more than the
   * access token: anyone holding one — 15 minutes of a stolen session — could call setup
   * → enable → verify with an authenticator of their own and come away with an
   * mfaVerified token for the loan and draw step-up routes, while the real owner's
   * authenticator silently stopped working. Moving MFA to a new device now means turning
   * it off first, which takes a code from the current one.
   */
  async setupMfa(userId: string): Promise<{ secret: string; qrCodeUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.mfaEnabled) {
      await this.audit.log({
        userId,
        action: 'MFA_VERIFY',
        entity: 'User',
        entityId: userId,
        metadata: { action: 'setup_refused', reason: 'already_enabled' },
      });
      throw new BadRequestException(
        'MFA is already enabled. To move it to a new device, turn it off with a code from ' +
          'your current authenticator first.',
      );
    }

    const secret = authenticator.generateSecret();
    const issuer = this.config.get('TOTP_ISSUER', 'PrimeTracker');
    const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Store encrypted secret (not yet enabled). The replay marker belongs to the old
    // secret, if there was one, so it goes too.
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: this.encryption.encrypt(secret), mfaLastUsedStep: null },
    });

    return { secret, qrCodeUrl };
  }

  async enableMfa(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled for this account');
    }
    if (!user.mfaSecret) {
      throw new BadRequestException('MFA not set up. Call setup first.');
    }

    const result = await this.consumeTotp(user, token);
    if (result !== 'ok') {
      throw new BadRequestException(result === 'replayed' ? TOTP_REPLAYED_MESSAGE : 'Invalid TOTP code');
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

    const result = await this.consumeTotp(user, token);
    if (result !== 'ok') {
      throw new UnauthorizedException(result === 'replayed' ? TOTP_REPLAYED_MESSAGE : 'Invalid TOTP code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaLastUsedStep: null },
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

    const result = await this.consumeTotp(user, token);
    if (result !== 'ok') {
      throw new UnauthorizedException(result === 'replayed' ? TOTP_REPLAYED_MESSAGE : 'Invalid TOTP code');
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

  /**
   * Check a TOTP code and, if it is good, spend its time-step so it cannot be used again.
   *
   * window: 1 (top of file) keeps each code valid for about 90 seconds. Without a record
   * of what was already accepted, a code seen once — over a shoulder, in a request log, in
   * a screen share — could be sent again for that whole window. Every code-accepting path
   * (enable, disable, step-up) goes through here, so a code is good for exactly one of them.
   *
   * The step is claimed with a conditional write rather than read-then-update, so two
   * requests racing with the same code cannot both pass: only one UPDATE matches.
   */
  private async consumeTotp(
    user: { id: string; mfaSecret: string | null },
    token: string,
  ): Promise<TotpResult> {
    if (!user.mfaSecret) return 'invalid';

    // One clock reading for both the check and the step it maps to, so a 30-second
    // boundary falling between the two cannot record the wrong step.
    const now = Date.now();
    const secret = this.encryption.decrypt(user.mfaSecret);
    const delta = authenticator.clone({ epoch: now }).checkDelta(token, secret);
    if (delta === null) return 'invalid';

    const step = Math.floor(now / 1000 / authenticator.allOptions().step) + delta;
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    return claimed.count === 1 ? 'ok' : 'replayed';
  }
}
