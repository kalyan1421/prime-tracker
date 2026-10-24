import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcrypt';
import {
  AuthService,
  hashRefreshToken,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  REFRESH_REUSE_GRACE_MS,
} from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../common/utils/audit.service';

// bcrypt stays REAL — the timing test below depends on a genuine cost-12 compare — but is
// wrapped so calls can be observed. `import * as` yields a frozen namespace, which
// jest.spyOn cannot patch.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn((...args: unknown[]) => actual.compare(...args)) };
});
const compare = bcrypt.compare as unknown as jest.Mock;

/**
 * The authentication findings from the 2026-10-24 audit, one block each:
 *
 *  - MFA re-enrolment let a stolen access token mint an mfaVerified token, and a TOTP code
 *    could be replayed for its whole ±1-step window.
 *  - Refresh tokens were stored in plaintext and rotated read-then-update, so concurrent
 *    refreshes both succeeded and a reused token went unnoticed.
 *  - Password login had no per-account lockout, returned early for unknown emails (a
 *    timing oracle for which accounts exist), and never audited a failure.
 *  - Google sign-in trusted any email, verified or not, and ignored the stored googleId.
 */

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('signed-access'),
  decode: jest.fn().mockReturnValue({ iat: 1_000, exp: 1_900 }),
};

const mockEncryption = {
  encrypt: jest.fn((v: string) => `encrypted:${v}`),
  decrypt: jest.fn((v: string) => v.replace('encrypted:', '')),
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

const mockConfig = {
  get: jest.fn((key: string, fallback?: unknown) => {
    if (key === 'GOOGLE_ALLOWED_DOMAIN') return 'theprimedeveloper.com';
    return fallback ?? '';
  }),
  getOrThrow: jest.fn(() => 'test-secret'),
};

async function makeService(): Promise<AuthService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: JwtService, useValue: mockJwt },
      { provide: ConfigService, useValue: mockConfig },
      { provide: EncryptionService, useValue: mockEncryption },
      { provide: AuditService, useValue: mockAudit },
    ],
  }).compile();
  return module.get(AuthService);
}

const auditActions = () => mockAudit.log.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.refreshToken.create.mockResolvedValue({});
  mockJwt.sign.mockReturnValue('signed-access');
  mockJwt.decode.mockReturnValue({ iat: 1_000, exp: 1_900 });
});

// ---------------------------------------------------------------------------------------
describe('MFA: re-enrolment and replay', () => {
  let service: AuthService;
  const SECRET = authenticator.generateSecret();
  // 15 seconds into a 30-second step, so no code below straddles a step boundary.
  const NOW = 1_800_000_015_000;
  const STEP = Math.floor(NOW / 1000 / 30);
  const codeAt = (epoch: number) => authenticator.clone({ epoch }).generate(SECRET);

  const enrolled = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'cfo@theprimedeveloper.com', role: 'FINANCE',
    mfaEnabled: true, mfaSecret: `encrypted:${SECRET}`, mfaLastUsedStep: null,
    ...overrides,
  });

  let clock: jest.SpyInstance;

  beforeEach(async () => {
    service = await makeService();
    clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.update.mockResolvedValue({});
  });

  afterEach(() => clock.mockRestore());

  // The finding itself: setup → enable → verify with the attacker's own authenticator.
  it('refuses setup while MFA is enabled, leaving the existing secret alone', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());

    await expect(service.setupMfa('u1')).rejects.toBeInstanceOf(BadRequestException);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'MFA_VERIFY',
      metadata: expect.objectContaining({ action: 'setup_refused' }),
    }));
  });

  it('still lets an account WITHOUT MFA set it up', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ mfaEnabled: false, mfaSecret: null }));

    const res = await service.setupMfa('u1');

    expect(res.secret).toBeTruthy();
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { mfaSecret: `encrypted:${res.secret}`, mfaLastUsedStep: null },
    });
  });

  it('refuses to re-enable an already-enabled account', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
    await expect(service.enableMfa('u1', codeAt(NOW))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a fresh code, spends its time-step, and issues an mfaVerified token', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());

    await service.verifyMfa('u1', codeAt(NOW));

    // A conditional write — only a step later than the last one used can be claimed.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: STEP } }] },
      data: { mfaLastUsedStep: STEP },
    });
    expect(mockJwt.sign.mock.calls[0][0]).toEqual(expect.objectContaining({ mfaVerified: true }));
  });

  it('records the step the code was FOR, not the current one, when the window accepts an older code', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
    await service.verifyMfa('u1', codeAt(NOW - 30_000));
    expect(mockPrisma.user.updateMany.mock.calls[0][0].data).toEqual({ mfaLastUsedStep: STEP - 1 });
  });

  it('rejects a replayed code and issues nothing', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ mfaLastUsedStep: STEP }));
    // The database's answer to "is this step later than the last one used?" — no.
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.verifyMfa('u1', codeAt(NOW))).rejects.toThrow(/already been used/);
    expect(mockJwt.sign).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  // Two requests racing with the same code: both pass the TOTP check, only one write lands.
  it('lets exactly one of two concurrent uses of the same code through', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
    mockPrisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.verifyMfa('u1', codeAt(NOW)),
      service.verifyMfa('u1', codeAt(NOW)),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('rejects a wrong code without spending any step', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
    const wrong = codeAt(NOW) === '000000' ? '111111' : '000000';

    await expect(service.verifyMfa('u1', wrong)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('a code spent on step-up cannot then be used to turn MFA off', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled({ mfaLastUsedStep: STEP }));
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.disableMfa('u1', codeAt(NOW))).rejects.toThrow(/already been used/);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('disabling with a fresh code clears the secret and the replay marker', async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(enrolled());
    await service.disableMfa('u1', codeAt(NOW));
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { mfaEnabled: false, mfaSecret: null, mfaLastUsedStep: null },
    });
  });
});

// ---------------------------------------------------------------------------------------
describe('Refresh tokens: hashed, atomic, reuse-detecting', () => {
  let service: AuthService;
  const RAW = 'a'.repeat(128);
  const HASH = hashRefreshToken(RAW);

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt1', tokenHash: HASH, userId: 'u1',
    expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null,
    user: { id: 'u1', email: 'a@theprimedeveloper.com', role: 'SALES', isActive: true },
    ...overrides,
  });

  beforeEach(async () => {
    service = await makeService();
  });

  it('stores only a SHA-256 hash of the refresh token it hands out', async () => {
    const pair = await service.generateTokens('u1', 'a@b.c', 'SALES' as any, false);

    const stored = mockPrisma.refreshToken.create.mock.calls[0][0].data;
    expect(stored).not.toHaveProperty('token');
    expect(stored.tokenHash).toBe(hashRefreshToken(pair.refreshToken));
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(pair.refreshToken);
  });

  // It was a hardcoded 900 beside a configurable JWT_ACCESS_EXPIRY.
  it('reports expiresIn from the signed token, not a constant', async () => {
    mockJwt.decode.mockReturnValue({ iat: 1_000, exp: 4_600 });
    const pair = await service.generateTokens('u1', 'a@b.c', 'SALES' as any, false);
    expect(pair.expiresIn).toBe(3_600);
  });

  it('looks the token up by hash and rotates it with a conditional write', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(row());
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const pair = await service.refreshTokens(RAW);

    expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: HASH } }),
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: HASH, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(pair.refreshToken).not.toBe(RAW);
  });

  // The bug: both requests read an unrevoked row, both rotated, both got a session.
  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(row());
    mockPrisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([service.refreshTokens(RAW), service.refreshTokens(RAW)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    // Losing that race is not theft — no session-wide revocation.
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });

  it('treats a token revoked long ago coming back as theft: every session ends', async () => {
    const revokedAt = new Date(Date.now() - 5 * 60_000);
    mockPrisma.refreshToken.findUnique.mockResolvedValue(row({ revokedAt }));
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.refreshTokens(RAW)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'REFRESH_TOKEN_REUSE',
      userId: 'u1',
      metadata: expect.objectContaining({ sessionsRevoked: 3 }),
    }));
  });

  // Two tabs refreshing at the same instant: the loser presents a token spent milliseconds
  // ago. Logging the user out everywhere for that would happen every time a laptop wakes.
  it('lets a token revoked within the grace window go with a plain 401', async () => {
    const revokedAt = new Date(Date.now() - Math.floor(REFRESH_REUSE_GRACE_MS / 3));
    mockPrisma.refreshToken.findUnique.mockResolvedValue(row({ revokedAt }));

    await expect(service.refreshTokens(RAW)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(auditActions().map((a) => a.action)).not.toContain('REFRESH_TOKEN_REUSE');
  });

  it('rejects an unknown token', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.refreshTokens(RAW)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an expired token without rotating it', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(service.refreshTokens(RAW)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('logout revokes the presented token by its hash', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await service.logout('u1', RAW);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: HASH, userId: 'u1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

// ---------------------------------------------------------------------------------------
describe('Password login: lockout, timing, audit', () => {
  let service: AuthService;
  const client = { ipAddress: '203.0.113.7', userAgent: 'jest' };
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash('Correct-123', 4);
  });

  const account = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@theprimedeveloper.com', name: 'A', role: 'SALES', roles: [],
    isActive: true, passwordHash: hash, mfaEnabled: false, googleId: null,
    failedLoginCount: 0, lockedUntil: null,
    ...overrides,
  });

  beforeEach(async () => {
    service = await makeService();
    mockPrisma.user.update.mockResolvedValue({ failedLoginCount: 1 });
  });

  // Returning before bcrypt ran made "no such account" ~250ms faster than "wrong password".
  it('runs a full-cost bcrypt compare for an unknown email, then fails generically', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(service.loginWithPassword('nobody@x.com', 'guess', client))
      .rejects.toThrow('Invalid email or password');

    expect(compare).toHaveBeenCalledTimes(1);
    // Same cost as hashPassword(), or the timing gap only narrows instead of closing.
    expect(bcrypt.getRounds(compare.mock.calls[0][1] as string)).toBe(12);
  });

  it('does the same for an account that has no password (Google-only)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account({ passwordHash: null }));
    await expect(service.loginWithPassword('a@theprimedeveloper.com', 'x', client))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('audits a failure for an unknown email, with the address tried', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.loginWithPassword('nobody@x.com', 'guess', client)).rejects.toThrow();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED',
      ipAddress: '203.0.113.7',
      metadata: expect.objectContaining({ provider: 'password', reason: 'UNKNOWN_ACCOUNT', email: 'nobody@x.com' }),
    }));
  });

  it('counts a wrong password atomically and audits it', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account());
    mockPrisma.user.update.mockResolvedValue({ failedLoginCount: 3 });

    await expect(service.loginWithPassword('a@theprimedeveloper.com', 'wrong', client))
      .rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED', userId: 'u1',
      metadata: expect.objectContaining({ reason: 'BAD_PASSWORD' }),
    }));
  });

  it(`locks the account for ${LOCKOUT_MINUTES} minutes on the ${MAX_FAILED_LOGINS}th wrong password`, async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account());
    mockPrisma.user.update
      .mockResolvedValueOnce({ failedLoginCount: MAX_FAILED_LOGINS })
      .mockResolvedValueOnce({});
    const before = Date.now();

    await expect(service.loginWithPassword('a@theprimedeveloper.com', 'wrong', client))
      .rejects.toThrow(/locked for 15 more minutes/);

    const lock = mockPrisma.user.update.mock.calls[1][0];
    expect(lock.data.failedLoginCount).toBe(0);
    const until = (lock.data.lockedUntil as Date).getTime();
    expect(until).toBeGreaterThanOrEqual(before + LOCKOUT_MINUTES * 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + LOCKOUT_MINUTES * 60_000);
  });

  // A lock that still evaluated the password would be an oracle for it.
  it('refuses a locked account even with the right password, without checking it', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account({ lockedUntil: new Date(Date.now() + 5 * 60_000) }));

    await expect(service.loginWithPassword('a@theprimedeveloper.com', 'Correct-123', client))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(compare).not.toHaveBeenCalled();
    expect(mockJwt.sign).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED', metadata: expect.objectContaining({ reason: 'LOCKED' }),
    }));
  });

  it('lets the owner back in once the lock has expired, and clears the count', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(account({
      failedLoginCount: 4, lockedUntil: new Date(Date.now() - 1_000),
    }));
    mockPrisma.user.update.mockResolvedValue({});

    const res = await service.loginWithPassword('a@theprimedeveloper.com', 'Correct-123', client);

    expect(res.accessToken).toBe('signed-access');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date), failedLoginCount: 0, lockedUntil: null },
    });
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN', ipAddress: '203.0.113.7', userAgent: 'jest',
    }));
  });
});

// ---------------------------------------------------------------------------------------
describe('Google sign-in: verified email and a stable googleId', () => {
  let service: AuthService;
  const profile = (overrides: Record<string, unknown> = {}) => ({
    id: 'g-owner', email: 'raj@theprimedeveloper.com', emailVerified: true,
    displayName: 'Raj', picture: 'https://example.test/p.png',
    ...overrides,
  });
  const existing = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'raj@theprimedeveloper.com', name: 'Raj', role: 'SALES', roles: [],
    isActive: true, mfaEnabled: false, passwordHash: null, googleId: 'g-owner',
    ...overrides,
  });

  beforeEach(async () => {
    service = await makeService();
    mockPrisma.user.update.mockImplementation(({ data }: any) => Promise.resolve(existing(data)));
  });

  it('refuses an address Google has not verified, before looking anyone up', async () => {
    await expect(service.validateGoogleUser(profile({ emailVerified: false })))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED',
      metadata: expect.objectContaining({ provider: 'google', reason: 'EMAIL_NOT_VERIFIED' }),
    }));
  });

  // Matching on email alone meant any Google account presenting that address was the user.
  it('refuses a different Google account presenting a linked user\'s email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(existing());

    await expect(service.validateGoogleUser(profile({ id: 'g-someone-else' })))
      .rejects.toThrow(/linked to a different Google account/);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockJwt.sign).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED', userId: 'u1',
      metadata: expect.objectContaining({ reason: 'GOOGLE_ID_MISMATCH' }),
    }));
  });

  it('signs in the linked Google account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(existing());
    const res = await service.validateGoogleUser(profile());
    expect(res.user.id).toBe('u1');
  });

  it('binds the googleId on the first Google sign-in to an admin-created account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(existing({ googleId: null }));

    await service.validateGoogleUser(profile());

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { googleId: 'g-owner', avatarUrl: 'https://example.test/p.png' },
    });
  });

  it('does not link a deactivated account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(existing({ googleId: null, isActive: false }));
    await expect(service.validateGoogleUser(profile())).rejects.toThrow('Account is deactivated');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('still only lets allow-listed domains create accounts, and audits the refusal', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.validateGoogleUser(profile({ email: 'stranger@gmail.com' })))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(auditActions()).toContainEqual(expect.objectContaining({
      action: 'LOGIN_FAILED', metadata: expect.objectContaining({ reason: 'DOMAIN_NOT_ALLOWED' }),
    }));
  });
});
