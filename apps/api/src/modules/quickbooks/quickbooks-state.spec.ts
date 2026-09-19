import { ForbiddenException } from '@nestjs/common';
import { QuickbooksService } from './quickbooks.service';

/**
 * The QuickBooks callback is necessarily unauthenticated — Intuit redirects the user's
 * browser to it with no bearer token — so `state` is the only thing tying an inbound
 * callback to a connect request someone with quickbooks:manage actually started.
 *
 * It used to be `'prime-tracker-' + Date.now()`: not random, never stored, and never
 * checked. Anyone on the internet could authorize Prime's QB app against their OWN Intuit
 * company and hand the resulting code to this endpoint; the server would exchange it and
 * upsert an active QBConnection, which getConnection() could then hand every sync.
 *
 * These tests drive the service directly rather than over HTTP, because the QB_ENABLED
 * feature flag short-circuits the route before any of this is reachable in a dev process.
 */
function makeService(env: Record<string, string> = {}) {
  const config: any = {
    get: (k: string, d?: string) => env[k] ?? d,
  };
  const prisma: any = { qBConnection: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() } };
  const encryption: any = { encrypt: (v: string) => v, decrypt: (v: string) => v };
  const audit: any = { log: jest.fn() };
  return new QuickbooksService(prisma, config, encryption, audit);
}

const ENABLED = { QB_ENABLED: 'true', QB_CLIENT_ID: 'id', QB_CLIENT_SECRET: 'secret', QB_REDIRECT_URI: 'https://x/cb' };

/**
 * Stub the token exchange.
 *
 * Without this the two tests that deliberately get PAST the state check go on to call
 * Intuit's real endpoint — slow, and dependent on the network to fail the right way. The
 * assertion is "did consumeState let this through", so a stub that rejects is enough, and
 * it keeps the reason for the rejection under this test's control.
 */
beforeEach(() => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Pull the `state` query param back out of the URL getAuthUrl builds. */
function stateFrom(url: string): string {
  return new URL(url).searchParams.get('state')!;
}

describe('QuickBooks OAuth state', () => {
  it('issues a long random state, different every time', () => {
    const service = makeService(ENABLED);
    const a = stateFrom(service.getAuthUrl());
    const b = stateFrom(service.getAuthUrl());

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toEqual(b);
    // The old value was derived from the clock, so it was guessable within a window.
    expect(a).not.toContain('prime-tracker');
  });

  it('rejects a callback with no state at all', async () => {
    const service = makeService(ENABLED);
    await expect(service.handleCallback('code', 'realm')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a state the server never issued', async () => {
    const service = makeService(ENABLED);
    service.getAuthUrl();
    await expect(service.handleCallback('code', 'realm', 'f'.repeat(64)))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a clock-derived state of the shape the old code produced', async () => {
    const service = makeService(ENABLED);
    await expect(service.handleCallback('code', 'realm', `prime-tracker-${Date.now()}`))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts an issued state exactly once (no replay)', async () => {
    const service = makeService(ENABLED);
    const state = stateFrom(service.getAuthUrl());

    // First use gets PAST the state check — it then fails at the network call, which is
    // what we want to observe: a ForbiddenException here would mean state was rejected.
    await expect(service.handleCallback('code', 'realm', state))
      .rejects.not.toBeInstanceOf(ForbiddenException);

    // Second use is refused: the state was consumed.
    await expect(service.handleCallback('code', 'realm', state))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consumes the state even when the exchange afterwards fails', async () => {
    const service = makeService(ENABLED);
    const state = stateFrom(service.getAuthUrl());
    await expect(service.handleCallback('code', 'realm', state)).rejects.toBeTruthy();
    await expect(service.handleCallback('code', 'realm', state))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('expires a state that is never used', async () => {
    jest.useFakeTimers();
    try {
      const service = makeService(ENABLED);
      const state = stateFrom(service.getAuthUrl());
      jest.advanceTimersByTime(11 * 60 * 1000); // TTL is 10 minutes
      await expect(service.handleCallback('code', 'realm', state))
        .rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      jest.useRealTimers();
    }
  });
});
