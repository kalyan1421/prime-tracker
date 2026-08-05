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
