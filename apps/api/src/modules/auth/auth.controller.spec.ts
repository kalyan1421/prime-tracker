import { ValidationPipe } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshTokenDto } from './dto/refresh-token.dto';
import { MfaTokenDto } from './dto/mfa-token.dto';

/**
 * The controller half of the 2026-10-24 auth fixes: the Google callback's token handoff,
 * and real DTOs where the routes used to take inline types the ValidationPipe never saw.
 */

const authService = {
  validateGoogleUser: jest.fn(),
  loginWithPassword: jest.fn(),
  refreshTokens: jest.fn(),
};
const config = { get: jest.fn((_k: string, fallback?: string) => fallback) };

const controller = new AuthController(authService as any, config as any);

const fakeReq = (extra: Record<string, unknown> = {}) =>
  ({ ip: '198.51.100.4', headers: { 'user-agent': 'Mozilla/5.0' }, ...extra }) as any;

describe('GET /auth/google/callback — token handoff', () => {
  const user = { id: 'u1', email: 'raj@theprimedeveloper.com', name: 'Raj & Co', role: 'SALES' };

  beforeEach(() => {
    jest.clearAllMocks();
    authService.validateGoogleUser.mockResolvedValue({
      accessToken: 'acc.jwt.sig', refreshToken: 'f'.repeat(128), expiresIn: 900, user,
    });
  });

  const redirectTarget = async () => {
    const res = { redirect: jest.fn() };
    await controller.googleCallback(fakeReq({ user: { id: 'g1', email: user.email, emailVerified: true } }), res as any);
    return new URL(res.redirect.mock.calls[0][0]);
  };

  // A query string is part of the request for /auth/callback, so it reached every access
  // log on the way. A fragment is never sent to a server.
  it('puts the tokens in the URL fragment, never the query string', async () => {
    const url = await redirectTarget();

    expect(url.pathname).toBe('/auth/callback');
    expect(url.search).toBe('');
    const handoff = new URLSearchParams(url.hash.slice(1));
    expect(handoff.get('accessToken')).toBe('acc.jwt.sig');
    expect(handoff.get('refreshToken')).toBe('f'.repeat(128));
    expect(handoff.get('expiresIn')).toBe('900');
  });

  it('encodes the user once, as JSON the page can parse directly', async () => {
    const url = await redirectTarget();
    expect(JSON.parse(new URLSearchParams(url.hash.slice(1)).get('user')!)).toEqual(user);
  });

  it('passes where the request came from, for the audit row', async () => {
    await redirectTarget();
    expect(authService.validateGoogleUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1' }),
      { ipAddress: '198.51.100.4', userAgent: 'Mozilla/5.0' },
    );
  });
});

describe('POST /auth/login — client context', () => {
  it('hands the caller IP and user agent to the service', async () => {
    authService.loginWithPassword.mockResolvedValue({});
    await controller.login({ email: 'a@b.c', password: 'pw' } as LoginDto, fakeReq());
    expect(authService.loginWithPassword).toHaveBeenCalledWith('a@b.c', 'pw', {
      ipAddress: '198.51.100.4', userAgent: 'Mozilla/5.0',
    });
  });
});

/**
 * The pipe as main.ts configures it. These routes used inline `{ ... }` body types, which
 * are erased at runtime — the pipe had no class to validate against and let anything
 * through. forbidNonWhitelisted is what turns an undeclared field into a 400.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const accepts = (Dto: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: Dto });
const rejects = async (Dto: any, body: Record<string, unknown>) => {
  await expect(accepts(Dto, body)).rejects.toMatchObject({ status: 400 });
};

describe('auth DTOs', () => {
  it('LoginDto takes an email and a password, and nothing else', async () => {
    await expect(accepts(LoginDto, { email: 'a@b.c', password: 'Prime@123' })).resolves.toBeInstanceOf(LoginDto);
    await rejects(LoginDto, { email: 'a@b.c' });
    await rejects(LoginDto, { email: 'a@b.c', password: '' });
    await rejects(LoginDto, { email: { $ne: null }, password: 'x' });
    await rejects(LoginDto, { email: 'a@b.c', password: 'x', role: 'SUPER_ADMIN' });
  });

  it('RefreshTokenDto requires a string token', async () => {
    await expect(accepts(RefreshTokenDto, { refreshToken: 'a'.repeat(128) })).resolves.toBeDefined();
    await rejects(RefreshTokenDto, {});
    await rejects(RefreshTokenDto, { refreshToken: 12345 });
  });

  // The web client's logout sends no body at all.
  it('LogoutDto accepts an empty body', async () => {
    await expect(accepts(LogoutDto, {})).resolves.toBeInstanceOf(LogoutDto);
    await rejects(LogoutDto, { refreshToken: ['a'] });
  });

  it('MfaTokenDto accepts exactly six digits', async () => {
    await expect(accepts(MfaTokenDto, { token: '012345' })).resolves.toBeDefined();
    await rejects(MfaTokenDto, { token: '12345' });
    await rejects(MfaTokenDto, { token: '1234567' });
    await rejects(MfaTokenDto, { token: '12a456' });
    await rejects(MfaTokenDto, { token: 123456 });
  });
});
