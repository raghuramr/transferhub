import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { LogoTile } from '../../components/shared/Logo';
import { authApi, demoLoginApi, type DemoLoginPublic, type DemoLoginUser } from '../../lib/api';
import { DemoLoginBox } from '../../components/auth/DemoLoginBox';
import { useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import type { AxiosError } from 'axios';
import type { ApiError } from '../../types';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // Demo accounts are controlled by the super admin (System Settings > Demo login). Any failure -> show nothing.
  const [demo, setDemo] = useState<DemoLoginPublic | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    demoLoginApi.publicGet().then((r) => { if (alive) setDemo(r.data); }).catch(() => { if (alive) setDemo(null); });
    return () => { alive = false; };
  }, []);

  // One-click demo sign-in: the server issues a real session for the configured account.
  const demoLogin = async (u: DemoLoginUser) => {
    setServerError('');
    setDemoBusy(u.userId);
    try {
      const res = await demoLoginApi.loginAs(u.userId);
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      navigate(res.data.user.mustChangePass ? '/change-password' : '/');
    } catch (e) {
      const err = e as AxiosError<ApiError>;
      setServerError(err.response?.data?.message ?? 'Demo sign-in is not available right now.');
      setDemoBusy(null);
    }
  };

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const res = await authApi.login(data.email, data.password);
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      if (res.data.user.mustChangePass) {
        navigate('/change-password');
      } else {
        navigate('/');
      }
    } catch (e) {
      const err = e as AxiosError<ApiError>;
      setServerError(err.response?.data?.message ?? 'Login failed. Please try again.');
    }
  };

  return (
    <div className="relative min-h-screen bg-brand-950 flex items-center justify-center p-4 overflow-hidden">
      {/* Fluid gradient blobs — 21st.dev-style ambient background */}
      <motion.div
        className="absolute -top-32 -left-32 w-[32rem] h-[32rem] rounded-full bg-brand-700/40 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-40 -right-20 w-[36rem] h-[36rem] rounded-full bg-brand-500/30 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_60%)]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-center mb-8"
        >
          <Link to="/" aria-label="TransferHub home"><LogoTile width={240} className="mb-4" /></Link>
          <h1 className="sr-only">TransferHub</h1>
          <p className="text-brand-200 mt-1 text-lg">Transfer Credit Portal</p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-8"
        >
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

          {serverError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex items-center gap-3 p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
            >
              <AlertCircle size={18} className="shrink-0" />
              {serverError}
            </motion.div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email address
              </label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                placeholder="you@bu.edu"
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors ${
                  errors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
              {errors.email && (
                <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`w-full px-4 py-2.5 pr-11 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors ${
                    errors.password ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full"
              icon={!isSubmitting ? <ArrowRight size={16} /> : undefined}
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="text-sm text-gray-500 text-center mt-5">
            New student?{' '}
            <Link to="/register" className="text-brand-800 font-medium hover:underline">Create an account</Link>
          </p>
          <p className="text-sm text-gray-500 text-center mt-2">
            <Link to="/intake" className="text-brand-800 font-medium hover:underline">Find my records from my previous university</Link>
          </p>

          <DemoLoginBox demo={demo} onPick={demoLogin} busyId={demoBusy} />
        </motion.div>
      </motion.div>
    </div>
  );
}
