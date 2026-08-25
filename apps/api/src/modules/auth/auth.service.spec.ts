import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../common/utils/audit.service';

// Mock PrismaService
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  // changePassword writes the hash and revokes sessions together.
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-token'),
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
};

const mockEncryptionService = {
  encrypt: jest.fn((val: string) => `encrypted:${val}`),
  decrypt: jest.fn((val: string) => val.replace('encrypted:', '')),
};

const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      TOTP_ISSUER: 'PrimeTracker',
    };
    return map[key] || '';
  }),
  getOrThrow: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    };
    return map[key] || '';
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    // AuthService uses this.prisma directly, so we override it
    service = module.get<AuthService>(AuthService);
    (service as any).prisma = mockPrisma;
    (service as any).jwt = mockJwtService;
    (service as any).config = mockConfigService;
    (service as any).encryption = mockEncryptionService;
    (service as any).audit = mockAuditService;
  });

  /**
   * The gate was a single exact-match value hardcoded to primedevelopers.com, which
   * covers 4 accounts. The 31 real staff are on theprimedeveloper.com and would every
   * one of them have been refused the moment SSO went live — with a 403 reading
   * "Only @primedevelopers.com accounts are allowed", which looks like a permissions
   * bug rather than a config one.
   */
  describe('validateGoogleUser: allowed-domain gate', () => {
    const profileOn = (email: string) => ({
      id: 'g-1', email, displayName: 'Someone', picture: '',
    });
    // Every case below states its own findUnique result. Without this, a mock set by
    // one test leaks into the next and quietly inverts what it proves.
    beforeEach(() => {
      mockPrisma.user.create.mockClear();
      mockPrisma.user.findUnique.mockReset();
    });

    const withDomains = (value: string) => {
      mockConfigService.get.mockImplementation((k: string) =>
        k === 'GOOGLE_ALLOWED_DOMAIN' ? value : '');
    };

    afterEach(() => {
      mockConfigService.get.mockImplementation((k: string) => {
        const map: Record<string, string> = {
          JWT_ACCESS_SECRET: 'test-access-secret',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
          TOTP_ISSUER: 'PrimeTracker',
        };
        return map[k] || '';
      });
    });

    it.each([
      ['theprimedeveloper.com', 'raj@theprimedeveloper.com'],
      ['primedevelopers.com', 'mallik@primedevelopers.com'],
    ])('lets a NEW %s account provision itself', async (_d, email) => {
      withDomains('theprimedeveloper.com,primedevelopers.com');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u', email, name: 'Someone', role: 'VIEWER', isActive: true,
      });
      await expect(service.validateGoogleUser(profileOn(email))).resolves.toBeDefined();
    });

    // The reason the gate exists. VIEWER carries project/building/unit/milestone/
    // comment/daily-log view across the WHOLE portfolio, so a stranger self-registering
    // is a data leak, not an inconvenience.
    it('refuses to CREATE an account for an off-domain address', async () => {
      withDomains('theprimedeveloper.com,primedevelopers.com');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.validateGoogleUser(profileOn('stranger@gmail.com')))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    // ...but a colleague on a personal address whom an admin already provisioned is a
    // different question entirely, and must not be locked out.
    it('lets an EXISTING off-domain account sign in', async () => {
      withDomains('theprimedeveloper.com,primedevelopers.com');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-9', email: 'colleague@gmail.com', name: 'Colleague',
        role: 'VIEWER', isActive: true, googleId: 'g-1',
      });
      await expect(service.validateGoogleUser(profileOn('colleague@gmail.com')))
        .resolves.toBeDefined();
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('tolerates spaces around the commas', async () => {
      withDomains(' theprimedeveloper.com , primedevelopers.com ');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u', email: 'a@primedevelopers.com', name: 'A', role: 'VIEWER', isActive: true,
      });
      await expect(service.validateGoogleUser(profileOn('a@primedevelopers.com')))
        .resolves.toBeDefined();
    });

    it('matches case-insensitively, since Google may return mixed case', async () => {
      withDomains('theprimedeveloper.com');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u', email: 'A@TheDev.com', name: 'A', role: 'VIEWER', isActive: true,
      });
      await expect(service.validateGoogleUser(profileOn('Raj@TheDevPrime.com')))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.validateGoogleUser(profileOn('Raj@THEPRIMEDEVELOPER.COM')))
        .resolves.toBeDefined();
    });

    // The branch below this gate CREATES a user for an unrecognised email. An empty
    // gate therefore lets any Google account on earth provision itself an account,
    // which is a far worse failure than locking someone out.
    // Fail closed. The old code treated an unset gate as "no restriction", so a missing
    // or typo'd env var silently opened self-registration to every Google account on
    // earth. A config mistake should lock people out, never let strangers in.
    it('with the gate UNSET, refuses to provision anyone at all', async () => {
      withDomains('');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.validateGoogleUser(profileOn('anyone@anywhere.com')))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('with the gate UNSET, an existing account can still sign in', async () => {
      withDomains('');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'staff@theprimedeveloper.com', name: 'Staff',
        role: 'VIEWER', isActive: true, googleId: 'g-1',
      });
      await expect(service.validateGoogleUser(profileOn('staff@theprimedeveloper.com')))
        .resolves.toBeDefined();
    });

    it('a single configured domain still gates provisioning', async () => {
      withDomains('primedevelopers.com');
      mockPrisma.user.findUnique.mockResolvedValue(null); // nobody by this email yet
      await expect(service.validateGoogleUser(profileOn('x@theprimedeveloper.com')))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('validateGoogleUser', () => {
    const googleProfile = {
      id: 'google-123',
      email: 'mallik@primedevelopers.com',
      displayName: 'Mallik Reddy',
      picture: 'https://lh3.google.com/photo.jpg',
    };

    it('should return existing user and update lastLoginAt', async () => {
      const existingUser = {
        id: 'user-1',
        email: googleProfile.email,
        name: googleProfile.displayName,
        role: 'FOUNDER',
        isActive: true,
        mfaEnabled: false,
      };

      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({ ...existingUser, lastLoginAt: new Date() });

      const result = await service.validateGoogleUser(googleProfile);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: googleProfile.email },
      });
      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should create new user if not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const newUser = {
        id: 'user-new',
        email: googleProfile.email,
        name: googleProfile.displayName,
        role: 'VIEWER',
        isActive: true,
        mfaEnabled: false,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      // The profile is @primedevelopers.com, so the gate has to permit that domain for
      // self-provisioning to be reachable at all. This used to pass with the gate unset
      // because unset meant "no restriction" — it now means "no self-provisioning".
      mockConfigService.get.mockImplementation((k: string) =>
        k === 'GOOGLE_ALLOWED_DOMAIN' ? 'primedevelopers.com' : '');

      const result = await service.validateGoogleUser(googleProfile);

      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject inactive user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-disabled',
        email: googleProfile.email,
        googleId: 'google-123', // already linked → skips the update branch, hits the isActive check
        isActive: false,
      });

      await expect(service.validateGoogleUser(googleProfile)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      mockJwtService.sign = jest.fn().mockReturnValue('access-token-123');
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.generateTokens(
        'user-1',
        'test@primedevelopers.com',
        'FOUNDER' as any,
        false,
      );

      expect(result.accessToken).toBe('access-token-123');
      expect(result.refreshToken).toBeDefined();
      expect(mockJwtService.sign).toHaveBeenCalled();
    });
  });
});

describe('AuthService.changePassword', () => {
  const bcrypt = require('bcrypt');
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    mockPrisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
  });

  const withPassword = async (plain: string) => ({
    id: 'u1', email: 'a@b.c', passwordHash: await bcrypt.hash(plain, 4),
  });

  it('rejects a wrong current password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await withPassword('Correct-123'));
    await expect(service.changePassword('u1', 'WRONG', 'BrandNew-456')).rejects.toThrow(/Current password is incorrect/);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('explains itself for a Google-SSO account instead of failing on a null hash', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c', passwordHash: null });
    await expect(service.changePassword('u1', 'anything', 'BrandNew-456')).rejects.toThrow(/signs in with Google/);
  });

  it('refuses a new password identical to the current one', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await withPassword('Same-1234'));
    await expect(service.changePassword('u1', 'Same-1234', 'Same-1234')).rejects.toThrow(/different from the current/);
  });

  it('refuses a new password under 8 characters', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await withPassword('Correct-123'));
    await expect(service.changePassword('u1', 'Correct-123', 'short')).rejects.toThrow(/at least 8 characters/);
  });

  it('stores a HASH, never the plaintext, and revokes every other session', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(await withPassword('Correct-123'));

    const res = await service.changePassword('u1', 'Correct-123', 'BrandNew-456');

    const written = mockPrisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(written).not.toBe('BrandNew-456');
    expect(await bcrypt.compare('BrandNew-456', written)).toBe(true);
    // A stolen refresh token must not outlive the password it was issued under.
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(res.sessionsRevoked).toBe(2);
  });
});
