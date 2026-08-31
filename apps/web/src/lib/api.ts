import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { useMfaStepUpStore } from '../store/mfaStepUpStore';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function apiAssetUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl}`;
}

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // A file upload has to lose the instance-wide JSON content type.
  //
  // `application/json` is set as a default above because almost every call is JSON — but
  // it also overrides what a FormData body needs, which is
  // `multipart/form-data; boundary=…`. Only the browser can produce that boundary, and it
  // only does so when the header is absent. Leave it in place and the server receives a
  // body it cannot parse, then answers "No file was received" — a message that points at
  // the file input rather than at the header that actually broke it.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Handle 401 → refresh token
//
// Two things this has to get right, both learned from real sessions ending at the
// 15-minute access-token mark:
//
//  1. The server ROTATES refresh tokens — using one revokes it. Two tabs each hold their
//     own copy in memory, so the tab that refreshes second presents a token the first tab
//     already spent, gets a 401, and would end a session that is perfectly alive. The
//     newer token is sitting in localStorage; use it instead of logging out.
//  2. Only an actual auth rejection means the session is over. A network blip, a 502 while
//     the API restarts, a laptop waking up, a 429 — none of those say anything about the
//     refresh token, and destroying the session over them is how a user gets thrown back
//     to the login screen for no visible reason.
const AUTH_STORAGE_KEY = 'prime-tracker-auth';

/** The refresh token as another TAB may have just rewritten it — zustand's in-memory
 * state is per-tab, so localStorage is the only shared view. */
function persistedRefreshToken(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw)?.state?.refreshToken ?? null) : null;
  } catch {
    return null;
  }
}

/** Thrown only when the session genuinely cannot continue — the one case that logs out. */
class SessionEndedError extends Error {
  constructor() { super('Session ended'); }
}

async function postRefresh(refreshToken: string): Promise<string> {
  const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken });
  useAuthStore.getState().updateTokens(data.accessToken, data.refreshToken);
  return data.accessToken as string;
}

async function requestNewAccessToken(): Promise<string> {
  const attempted = useAuthStore.getState().refreshToken;
  if (!attempted) throw new SessionEndedError();
  try {
    return await postRefresh(attempted);
  } catch (e) {
    const status = (e as AxiosError)?.response?.status;
    if (status !== 401 && status !== 403) throw e; // not a verdict on the token — keep the session
    const newer = persistedRefreshToken();
    if (newer && newer !== attempted) {
      // Another tab rotated first. Its token is the live one.
      try {
        return await postRefresh(newer);
      } catch (retryError) {
        const retryStatus = (retryError as AxiosError)?.response?.status;
        if (retryStatus === 401 || retryStatus === 403) throw new SessionEndedError();
        throw retryError;
      }
    }
    throw new SessionEndedError();
  }
}

let isRefreshing = false;
let failedQueue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const newAccess = await requestNewAccessToken();
      originalRequest.headers.Authorization = `Bearer ${newAccess}`;
      processQueue(null, newAccess);
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      // Anything short of a rejected token leaves the session in place: the failed call
      // surfaces its own error, and the next request tries the refresh again.
      if (refreshError instanceof SessionEndedError) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

// Handle 403 "MFA required" → pause, prompt for TOTP step-up, then retry
//
// Deliberately a literal, NOT an import from @prime-tracker/shared: the web app has no
// dependency on that package and the deploy-web CI job does not build it, so importing
// here breaks the production deploy rather than just the local build. The canonical value
// lives in shared as MFA_REQUIRED_MESSAGE, and mfa-message-parity.spec.ts fails if this
// copy ever drifts from it.
const MFA_REQUIRED_MESSAGE = 'MFA verification required for this action. Please verify your TOTP code.';
// This is a *separate* interceptor from the 401 one above: axios chains
// response interceptors, so when the 401 handler rejects because the status
// isn't 401 (or `_retry` is already set), that rejection flows into this
// handler next. Nothing about the 401/refresh flow is touched.

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _mfaRetry?: boolean })
      | undefined;

    const isMfaStepUpRequired =
      error.response?.status === 403 &&
      (error.response?.data as { message?: string } | undefined)?.message === MFA_REQUIRED_MESSAGE;

    if (!isMfaStepUpRequired || !originalRequest || originalRequest._mfaRetry) {
      return Promise.reject(error);
    }

    // Mark so a repeat 403 on the retried request doesn't loop forever.
    originalRequest._mfaRetry = true;

    try {
      // Pauses here until a human supplies a valid TOTP code via
      // MfaStepUpModal and calls resolveMfaStepUp() — or rejects if the
      // user cancels / has no MFA enrolled. If a step-up is already
      // pending for another request, this just joins that same queue.
      await useMfaStepUpStore.getState().requestStepUp();
      // Fresh access token is picked up automatically by the request
      // interceptor above, which reads useAuthStore.getState().accessToken
      // on every call.
      return api(originalRequest);
    } catch (mfaError) {
      return Promise.reject(mfaError);
    }
  },
);

export default api;
