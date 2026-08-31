import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  phone?: string | null;
  jobTitle?: string | null;
  role: string;
  roles: string[];
  permissions: string[];
  mfaEnabled: boolean;
  mfaVerified: boolean;
  /** How the account signs in. Booleans only — the API never sends the hash. */
  hasPassword?: boolean;
  googleLinked?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  patchUser: (patch: Partial<AuthUser>) => void;
  updateTokens: (accessToken: string, refreshToken: string) => void;
  setMfaVerified: (verified: boolean) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      updateTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setMfaVerified: (verified) =>
        set((s) => ({
          user: s.user ? { ...s.user, mfaVerified: verified } : null,
        })),

      /** Merge fresh identity fields after a self-profile save, so the TopBar avatar
          and name update without forcing a re-login. */
      patchUser: (patch: Partial<AuthUser>) =>
        set((s) => ({ user: s.user ? { ...s.user, ...patch } : null })),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),

      hasPermission: (permission) => {
        const { user } = get();
        return user?.permissions?.includes(permission) ?? false;
      },

      hasAnyPermission: (...permissions) => {
        const { user } = get();
        return permissions.some((p) => user?.permissions?.includes(p)) ?? false;
      },
    }),
    {
      name: 'prime-tracker-auth',
    },
  ),
);

/**
 * Adopt what another tab wrote.
 *
 * Tokens are persisted to localStorage but the store's state is per-tab, so two open tabs
 * drift apart the moment either one refreshes — and because the server rotates refresh
 * tokens, the tab holding the older copy would present a spent token at its own
 * 15-minute mark and be logged out of a live session. A `storage` event fires only in the
 * OTHER tabs, so re-reading on it is enough to keep every tab on the current pair. It also
 * makes "log out" and "log in as someone else" propagate, instead of leaving a second tab
 * apparently signed in as a user who is gone.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'prime-tracker-auth') useAuthStore.persist.rehydrate();
  });
}
