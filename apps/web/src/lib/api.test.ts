/**
 * The request interceptor, and specifically the FormData rule.
 *
 * This exists because of a real failure: the axios instance sets
 * `Content-Type: application/json` for every call, which silently overrode what a file
 * upload needs — `multipart/form-data; boundary=…`, a header only the browser can
 * produce, and only when none is already set. The server then answered "No file was
 * received", which points at the file input rather than at the header that broke it.
 *
 * A test at this layer is worth more than one on any single upload screen: the default
 * belongs to the instance, so a regression here would break every upload in the product
 * at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Mutable so the refresh tests can move the tokens under the interceptor. */
const authState = vi.hoisted(() => ({
  accessToken: 'token-123',
  refreshToken: 'refresh-A',
  updateTokens: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => authState },
}));
vi.mock('../store/mfaStepUpStore', () => ({
  useMfaStepUpStore: { getState: () => ({ require: vi.fn() }) },
}));

import axios from 'axios';
import api from './api';

/** The interceptor axios would run before sending. */
function requestInterceptor() {
  const handlers = (api.interceptors.request as any).handlers.filter(Boolean);
  return handlers[0].fulfilled as (c: any) => any;
}

const configWith = (data: unknown) => ({
  data,
  headers: { 'Content-Type': 'application/json' } as Record<string, unknown>,
});

describe('api request interceptor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops the JSON content type on a FormData body, so the browser can set the boundary', () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'site.png', { type: 'image/png' }));

    const out = requestInterceptor()(configWith(form));

    expect(out.headers['Content-Type']).toBeUndefined();
  });

  it('leaves the JSON content type alone on an ordinary body', () => {
    const out = requestInterceptor()(configWith({ title: 'A task' }));
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  it('leaves it alone when there is no body at all', () => {
    const out = requestInterceptor()(configWith(undefined));
    expect(out.headers['Content-Type']).toBe('application/json');
  });

  it('still attaches the bearer token to a file upload', () => {
    // The two rules share one interceptor; dropping a header must not drop the auth.
    const form = new FormData();
    const out = requestInterceptor()(configWith(form));
    expect(out.headers.Authorization).toBe('Bearer token-123');
  });
});

/**
 * The 401 → refresh path, which is what stands between a 15-minute access token and a
 * user being thrown back to the login screen.
 *
 * Both cases below came from real sessions ending for no good reason: a second tab
 * presenting a refresh token the first tab had already rotated away, and a refresh call
 * that simply failed to reach the server. Neither means the session is over, and treating
 * them as though it were is a logout the user cannot explain.
 */
describe('api response interceptor — refresh', () => {
  /** The rejection handler axios would run on a failed response. */
  function responseRejected() {
    const handlers = (api.interceptors.response as any).handlers.filter(Boolean);
    return handlers[0].rejected as (e: any) => Promise<unknown>;
  }

  const unauthorized = () => ({
    response: { status: 401 },
    config: { headers: {} as Record<string, string>, url: '/projects', method: 'get' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.accessToken = 'token-123';
    authState.refreshToken = 'refresh-A';
    localStorage.clear();
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the session when the refresh call cannot reach the server', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('Network Error'), { response: undefined }));

    await expect(responseRejected()(unauthorized())).rejects.toThrow();

    expect(authState.logout).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  it('keeps the session when the refresh call fails with a server error', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue({ response: { status: 502 } });

    await expect(responseRejected()(unauthorized())).rejects.toBeTruthy();

    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('uses the token another tab rotated to, instead of ending a live session', async () => {
    // What a second tab's successful refresh leaves behind in shared storage.
    localStorage.setItem('prime-tracker-auth', JSON.stringify({ state: { refreshToken: 'refresh-B' } }));
    const post = vi.spyOn(axios, 'post')
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { accessToken: 'token-456', refreshToken: 'refresh-C' } });
    // The retried original request — irrelevant to this assertion, but it must resolve.
    vi.spyOn(api, 'request').mockResolvedValue({ data: {} } as any);

    await responseRejected()(unauthorized()).catch(() => undefined);

    expect(post).toHaveBeenNthCalledWith(1, expect.any(String), { refreshToken: 'refresh-A' });
    expect(post).toHaveBeenNthCalledWith(2, expect.any(String), { refreshToken: 'refresh-B' });
    expect(authState.updateTokens).toHaveBeenCalledWith('token-456', 'refresh-C');
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('does log out when the refresh token is genuinely rejected', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } });

    await expect(responseRejected()(unauthorized())).rejects.toBeTruthy();

    expect(authState.logout).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
  });
});
