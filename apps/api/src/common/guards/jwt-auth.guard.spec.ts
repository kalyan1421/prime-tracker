import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isDemoModeActive, JwtAuthGuard } from './jwt-auth.guard';

/**
 * `Bearer demo-SUPER_ADMIN` is full administrative access with no credential. It used to be
 * honoured whenever DEMO_MODE=true and NODE_ENV was anything but 'production' — including
 * unset, which main.ts records as what the live box actually had. It now needs
 * NODE_ENV=development exactly.
 */
describe('isDemoModeActive', () => {
  it.each([
    [{ DEMO_MODE: 'true', NODE_ENV: 'development' }, true],
    [{ DEMO_MODE: 'true', NODE_ENV: undefined }, false],
    [{ DEMO_MODE: 'true', NODE_ENV: '' }, false],
    [{ DEMO_MODE: 'true', NODE_ENV: 'test' }, false],
    [{ DEMO_MODE: 'true', NODE_ENV: 'staging' }, false],
    [{ DEMO_MODE: 'true', NODE_ENV: 'production' }, false],
    [{ DEMO_MODE: 'true', NODE_ENV: 'Development' }, false],
    [{ DEMO_MODE: 'false', NODE_ENV: 'development' }, false],
    [{ DEMO_MODE: undefined, NODE_ENV: 'development' }, false],
  ])('%o → %s', (env, expected) => {
    expect(isDemoModeActive(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe('JwtAuthGuard demo bypass', () => {
  const saved = { DEMO_MODE: process.env.DEMO_MODE, NODE_ENV: process.env.NODE_ENV };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
  // Stands in for passport: a demo token is not a JWT, so the real check rejects it.
  const passport = jest
    .spyOn(AuthGuard('jwt').prototype as any, 'canActivate')
    .mockReturnValue(false);

  const contextWith = (request: Record<string, any>) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  afterEach(() => {
    process.env.DEMO_MODE = saved.DEMO_MODE;
    process.env.NODE_ENV = saved.NODE_ENV;
    passport.mockClear();
  });
  afterAll(() => passport.mockRestore());

  it('admits a demo token on a developer machine', () => {
    process.env.DEMO_MODE = 'true';
    process.env.NODE_ENV = 'development';
    const request: Record<string, any> = { headers: { authorization: 'Bearer demo-VIEWER' } };

    expect(new JwtAuthGuard(reflector).canActivate(contextWith(request))).toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ role: 'VIEWER' }));
  });

  // The hole: DEMO_MODE leaking into anything that is not explicitly development.
  it.each([undefined, 'test', 'staging'])(
    'with NODE_ENV=%s, hands a demo token to the real JWT check instead',
    (nodeEnv) => {
      process.env.DEMO_MODE = 'true';
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      const request: Record<string, any> = { headers: { authorization: 'Bearer demo-SUPER_ADMIN' } };

      expect(new JwtAuthGuard(reflector).canActivate(contextWith(request))).toBe(false);
      expect(request.user).toBeUndefined();
      expect(passport).toHaveBeenCalledTimes(1);
    },
  );
});
