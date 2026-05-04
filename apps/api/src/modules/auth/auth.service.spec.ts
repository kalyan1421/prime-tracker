import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

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
    deleteMany: jest.fn(),
  },
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
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'EncryptionService', useValue: mockEncryptionService },
        { provide: 'AuditService', useValue: mockAuditService },
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

      const result = await service.validateGoogleUser(googleProfile);

      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject inactive user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-disabled',
        email: googleProfile.email,
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
