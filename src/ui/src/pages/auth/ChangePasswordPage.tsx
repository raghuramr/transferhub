import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a special character'),
    confirm: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormData = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setError('');
    try {
      await api.post('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      navigate('/');
    } catch {
      setError('Password change failed. Check your current password.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Lock className="text-amber-600" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Change Password</h1>
            <p className="text-sm text-gray-500">
              Hello {user?.firstName} — please set a new password to continue.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 mb-5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {[
            { name: 'currentPassword' as const, label: 'Current password' },
            { name: 'newPassword' as const, label: 'New password' },
            { name: 'confirm' as const, label: 'Confirm new password' },
          ].map(({ name, label }) => (
            <div key={name}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                {...register(name)}
                type="password"
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                  errors[name] ? 'border-red-400' : 'border-gray-300'
                }`}
              />
              {errors[name] && (
                <p className="text-xs text-red-600 mt-1">{errors[name]?.message}</p>
              )}
            </div>
          ))}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-brand-800 hover:bg-brand-900 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isSubmitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  );
}
