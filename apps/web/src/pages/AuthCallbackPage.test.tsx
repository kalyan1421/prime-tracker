/**
 * Google sign-in hands the session over in the URL fragment.
 *
 * The API used to redirect to `/auth/callback?accessToken=…&refreshToken=…`, which put a
 * 7-day refresh token into every access log between the browser and the server. A fragment
 * never leaves the browser — but it does sit in the address bar and history, so the page
 * has to wipe it the moment it has been read. These cases pin both halves, plus the trap
 * that reading it inside the effect would fall into under StrictMode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AuthCallbackPage from './AuthCallbackPage';

const setAuth = vi.fn();
vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ setAuth }),
}));

function Landed({ name }: { name: string }) {
  const loc = useLocation();
  return <div>{`${name}${loc.search}`}</div>;
}

const user = { id: 'u1', email: 'raj@theprimedeveloper.com', name: 'Raj', role: 'VIEWER' };

/** Puts the browser's (jsdom's) real URL where the API redirect would leave it. */
function arriveAt(url: string) {
  window.history.replaceState({ idx: 0 }, '', url);
}

function renderCallback(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={['/auth/callback']}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/" element={<Landed name="home" />} />
        <Route path="/login" element={<Landed name="login" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const fragmentFor = (u: unknown) =>
  new URLSearchParams({
    accessToken: 'acc-1',
    refreshToken: 'ref-1',
    expiresIn: '900',
    user: JSON.stringify(u),
  }).toString();

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    setAuth.mockClear();
    arriveAt('/');
  });

  it('signs in from the fragment and lands on the dashboard', async () => {
    arriveAt(`/auth/callback#${fragmentFor(user)}`);
    renderCallback();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(setAuth).toHaveBeenCalledWith(user, 'acc-1', 'ref-1');
  });

  it('wipes the tokens from the address bar and history entry, keeping router state', async () => {
    arriveAt(`/auth/callback#${fragmentFor(user)}`);
    renderCallback();
    await screen.findByText('home');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('ref-1');
    expect(window.history.state).toEqual({ idx: 0 });
  });

  // StrictMode runs the effect twice. If the fragment were read inside the effect, the
  // second run would find it already erased and send a good sign-in to the error page.
  it('survives StrictMode running the effect twice', async () => {
    arriveAt(`/auth/callback#${fragmentFor(user)}`);
    renderCallback(true);
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(screen.queryByText(/^login/)).not.toBeInTheDocument();
  });

  // The old query-string handoff is not honoured: accepting it would keep the leak alive
  // for anyone holding an old link or a stale API.
  it('ignores tokens in the query string', async () => {
    arriveAt(`/auth/callback?accessToken=acc-1&refreshToken=ref-1&user=${encodeURIComponent(JSON.stringify(user))}`);
    renderCallback();
    expect(await screen.findByText('login?error=missing')).toBeInTheDocument();
    expect(setAuth).not.toHaveBeenCalled();
  });

  it('reports a malformed user payload instead of signing in', async () => {
    arriveAt('/auth/callback#accessToken=a&refreshToken=r&user=%7Bnot-json');
    renderCallback();
    expect(await screen.findByText('login?error=parse')).toBeInTheDocument();
    expect(setAuth).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });
});
