import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { GraduationCap, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import type { AxiosError } from 'axios';
import type { ApiError } from '../../types';

const schema = z.object({
  // Account
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),

  // Communications
  mobile: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),

  // Location
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  countryOfOrigin: z.string().optional(),

  // Education
  priorInstitutionName: z.string().optional(),
  highestEducationLevel: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  gpa: z.string().optional(),
  graduationYear: z.string().optional(),

  // Target University / Program
  targetInstitutionId: z.string().optional(),
  targetProgramId: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-brand-800 uppercase tracking-wider pt-2 pb-1 border-b border-gray-100">
      {children}
    </h3>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const targetInstitutionId = watch('targetInstitutionId');

  const { data: universitiesData, isLoading: loadingUniversities } = useQuery({
    queryKey: ['public-universities'],
    queryFn: () => authApi.publicUniversities(),
  });
  const universities = universitiesData?.data ?? [];

  const { data: programsData, isLoading: loadingPrograms } = useQuery({
    queryKey: ['public-programs', targetInstitutionId],
    queryFn: () => authApi.publicPrograms(Number(targetInstitutionId)),
    enabled: !!targetInstitutionId,
  });
  const programs = programsData?.data ?? [];

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const res = await authApi.register({
        ...data,
        gpa: data.gpa ? Number(data.gpa) : undefined,
        graduationYear: data.graduationYear ? Number(data.graduationYear) : undefined,
        targetInstitutionId: data.targetInstitutionId ? Number(data.targetInstitutionId) : undefined,
        targetProgramId: data.targetProgramId ? Number(data.targetProgramId) : undefined,
      });
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      navigate('/student');
    } catch (e) {
      const err = e as AxiosError<ApiError>;
      setServerError(err.response?.data?.message ?? 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="relative min-h-screen bg-brand-950 flex items-center justify-center p-4 py-10 overflow-hidden">
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
        className="relative w-full max-w-2xl"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4">
            <GraduationCap className="text-brand-800" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">TransferHub</h1>
          <p className="text-brand-200 mt-1">Create your student account</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-6 sm:p-8"
        >
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Student registration</h2>

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
            <SectionHeading>Account</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name" error={errors.firstName?.message}>
                <input {...register('firstName')} className={inputClass} placeholder="Jane" />
              </Field>
              <Field label="Last name" error={errors.lastName?.message}>
                <input {...register('lastName')} className={inputClass} placeholder="Doe" />
              </Field>
            </div>
            <Field label="Email address" error={errors.email?.message}>
              <input {...register('email')} type="email" autoComplete="email" className={inputClass} placeholder="you@example.com" />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={`${inputClass} pr-11`}
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>

            <SectionHeading>Communications</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Mobile number">
                <input {...register('mobile')} className={inputClass} placeholder="+1 555 123 4567" />
              </Field>
              <Field label="Emergency contact name">
                <input {...register('emergencyContactName')} className={inputClass} />
              </Field>
              <Field label="Emergency contact phone">
                <input {...register('emergencyContactPhone')} className={inputClass} />
              </Field>
            </div>

            <SectionHeading>Location</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Address line 1">
                <input {...register('addressLine1')} className={inputClass} />
              </Field>
              <Field label="Address line 2">
                <input {...register('addressLine2')} className={inputClass} />
              </Field>
              <Field label="City">
                <input {...register('city')} className={inputClass} />
              </Field>
              <Field label="State / Province">
                <input {...register('state')} className={inputClass} />
              </Field>
              <Field label="Postal code">
                <input {...register('postalCode')} className={inputClass} />
              </Field>
              <Field label="Country">
                <input {...register('country')} className={inputClass} />
              </Field>
              <Field label="Country of origin">
                <input {...register('countryOfOrigin')} className={inputClass} />
              </Field>
            </div>

            <SectionHeading>Education</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Prior / current institution">
                <input {...register('priorInstitutionName')} className={inputClass} placeholder="e.g. Bunker Hill Community College" />
              </Field>
              <Field label="Highest education level">
                <select {...register('highestEducationLevel')} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="High School">High School</option>
                  <option value="Associate's">Associate's</option>
                  <option value="Bachelor's">Bachelor's</option>
                  <option value="Master's">Master's</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Field of study">
                <input {...register('fieldOfStudy')} className={inputClass} placeholder="e.g. Computer Science" />
              </Field>
              <Field label="GPA">
                <input {...register('gpa')} type="number" step="0.01" min="0" max="4.33" className={inputClass} placeholder="e.g. 3.50" />
              </Field>
              <Field label="Graduation year">
                <input {...register('graduationYear')} type="number" className={inputClass} placeholder="e.g. 2024" />
              </Field>
            </div>

            <SectionHeading>Transfer target</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="University">
                <select {...register('targetInstitutionId')} className={inputClass} disabled={loadingUniversities}>
                  <option value="">{loadingUniversities ? 'Loading…' : 'Select a university…'}</option>
                  {universities.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                  ))}
                </select>
              </Field>
              <Field label="Program">
                <select
                  {...register('targetProgramId')}
                  className={inputClass}
                  disabled={!targetInstitutionId || loadingPrograms}
                >
                  <option value="">
                    {!targetInstitutionId ? 'Select a university first…' : loadingPrograms ? 'Loading…' : 'Select a program…'}
                  </option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.degree ? ` — ${p.degree}` : ''}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2"
              icon={!isSubmitting ? <ArrowRight size={16} /> : undefined}
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="text-sm text-gray-500 text-center mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-800 font-medium hover:underline">Sign in</Link>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
