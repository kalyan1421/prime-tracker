import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { FiLock, FiMail, FiEye, FiEyeOff } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { DevQuickLogin } from '../components/DevQuickLogin';
import api from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required'); return; }
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/', { replace: true });
    } catch (err: any) {
      const status = err?.response?.status;
      if (!err?.response) {
        setError('Network error — check your connection and try again.');
      } else if (status === 429) {
        setError('Too many login attempts. Please wait a minute and try again.');
      } else if (status >= 500) {
        setError('Server error — please try again in a moment.');
      } else {
        setError(err?.response?.data?.message || 'Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-[480px] overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-6 sm:px-8 sm:py-8 text-white text-center">
          <img src="/logo-full-white.png" alt="Prime Tracker" className="h-9 sm:h-10 mx-auto mb-3" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <h1 className="text-lg sm:text-xl font-bold">Prime Tracker</h1>
          <p className="text-blue-200 text-xs sm:text-sm mt-1">Internal Project Management Platform</p>
        </div>

        {/* Form */}
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <Input
              type="email"
              label="Email"
              placeholder="you@prime.dev"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              startContent={<FiMail className="text-gray-400 flex-shrink-0" />}
              variant="bordered"
              autoComplete="email"
            />
            <Input
              type={showPassword ? 'text' : 'password'}
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              startContent={<FiLock className="text-gray-400 flex-shrink-0" />}
              endContent={
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-gray-400 hover:text-gray-600">
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              }
              variant="bordered"
              autoComplete="current-password"
            />

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            <Button
              type="submit"
              color="primary"
              size="lg"
              className="w-full font-semibold mt-1"
              isLoading={loading}
            >
              Sign In
            </Button>
          </form>

          {/* Dev Quick Login — local development only.
              `import.meta.env.DEV` is replaced with the literal `false` by Vite at
              build time, so this branch becomes dead code and the DevQuickLogin
              import is tree-shaken out. A production bundle does not contain it.
              See docs/DEV_LOGIN.md for how that is verified, and for the two other
              gates (API DEMO_MODE opt-in, and the production boot guard). */}
          {import.meta.env.DEV && <DevQuickLogin />}
        </div>
      </div>
    </div>
  );
}
