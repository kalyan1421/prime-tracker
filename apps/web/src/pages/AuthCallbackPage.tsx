import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useAuthStore } from '../store/authStore';

/**
 * Landing page for Google sign-in. The API redirects here with the session in the URL
 * FRAGMENT (`#accessToken=…&refreshToken=…&user=…`), never the query string: a fragment
 * is not sent to any server, so the tokens stay out of CloudFront/nginx access logs.
 *
 * It is still in the address bar and the history entry, though, so it is wiped with
 * replaceState as soon as it has been read — before the user can copy, bookmark or go
 * back to it.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  // Read once, during the first render. The effect below erases the fragment, and React
  // StrictMode runs effects twice in development — reading it inside the effect would find
  // it already gone on the second pass and bounce a successful sign-in to the error page.
  const [fragment] = useState(() => window.location.hash.replace(/^#/, ''));

  useEffect(() => {
    if (window.location.hash) {
      // Keep history.state: React Router keeps its own bookkeeping there.
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }

    const params = new URLSearchParams(fragment);
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const userJson = params.get('user');

    if (accessToken && refreshToken && userJson) {
      try {
        const user = JSON.parse(userJson);
        setAuth(user, accessToken, refreshToken);
        navigate('/', { replace: true });
      } catch {
        navigate('/login?error=parse', { replace: true });
      }
    } else {
      navigate('/login?error=missing', { replace: true });
    }
  }, [fragment, setAuth, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" color="primary" />
        <p className="text-gray-500">Signing you in...</p>
      </div>
    </div>
  );
}
