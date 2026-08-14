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
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../store/authStore', () => ({
  useAuthStore: { getState: () => ({ accessToken: 'token-123' }) },
}));
vi.mock('../store/mfaStepUpStore', () => ({
  useMfaStepUpStore: { getState: () => ({ require: vi.fn() }) },
}));

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
