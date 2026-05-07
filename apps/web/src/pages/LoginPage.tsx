import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { FiLock, FiMail, FiEye, FiEyeOff } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';

const DEV_ACCOUNTS = [
  { label: 'Super Admin',     email: 'superadmin@prime.dev',  color: 'danger'    as const },
  { label: 'Founder',         email: 'founder@prime.dev',     color: 'primary'   as const },
  { label: 'Executive',       email: 'executive@prime.dev',   color: 'primary'   as const },
  { label: 'Finance',         email: 'finance@prime.dev',     color: 'success'   as const },
  { label: 'Accounting',      email: 'accounting@prime.dev',  color: 'success'   as const },
  { label: 'AR/AP',           email: 'arap@prime.dev',        color: 'success'   as const },
  { label: 'Project Manager', email: 'pm@prime.dev',          color: 'secondary' as const },
  { label: 'Construction',    email: 'construction@prime.dev',color: 'warning'   as const },
  { label: 'Sales',           email: 'sales@prime.dev',       color: 'warning'   as const },
  { label: 'Marketing',       email: 'marketing@prime.dev',   color: 'secondary' as const },
  { label: 'Legal',           email: 'legal@prime.dev',       color: 'default'   as const },
  { label: 'Viewer',          email: 'viewer@prime.dev',      color: 'default'   as const },
];

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
      setError(err?.response?.data?.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (devEmail: string) => {
    setEmail(devEmail);
    setPassword('Prime@123');
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email: devEmail, password: 'Prime@123' });
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Login failed');
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

          {/* Dev Quick Login */}
          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs text-gray-400">
                <span className="bg-white px-3">Dev Quick Login — all use password: Prime@123</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
              {DEV_ACCOUNTS.map((a) => (
                <Button
                  key={a.email}
                  size="sm"
                  color={a.color}
                  variant="flat"
                  className="flex flex-col h-auto py-2 px-2 items-start text-left"
                  onPress={() => quickLogin(a.email)}
                  isDisabled={loading}
                >
                  <span className="font-semibold text-xs leading-tight">{a.label}</span>
                  <span className="text-[10px] opacity-60 font-normal truncate w-full">{a.email}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
