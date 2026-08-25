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
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) throw new Error('No refresh token');

      const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken });
      const { accessToken: newAccess, refreshToken: newRefresh } = data;
      useAuthStore.getState().updateTokens(newAccess, newRefresh);

      originalRequest.headers.Authorization = `Bearer ${newAccess}`;
      processQueue(null, newAccess);
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      useAuthStore.getState().logout();
      window.location.href = '/login';
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
