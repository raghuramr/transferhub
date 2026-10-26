import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, Globe2, GraduationCap, Info, Plus, Trash2 } from 'lucide-react';
import { authApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import type { AxiosError } from 'axios';
import type { ApiError } from '../../types';

// Mirrors BU's transfer process (see _designs/understanding/12 and 13).
const APPLICANT_TYPES = [
  { value: 'transfer_applicant', label: 'Applying to transfer', help: 'You are applying to BU from another college. Credit shown before admission is a preview only.' },
  { value: 'admitted_transfer', label: 'Admitted transfer student', help: 'You have been admitted to BU and need your transfer credit officially evaluated.' },
  { value: 'current_student', label: 'Current BU student', help: 'You want a course at another college pre-approved before you take it.' },
  { value: 'dual_enrollment', label: 'High school dual enrollment', help: 'You took college courses while in high school (your school sends a Dual Enrollment Form).' },
] as const;

const yearStr = z.string().optional().refine((v) => !v || /^(19|20)\d{2}$/.test(v), 'Enter a 4-digit year');

const schema = z
  .object({
    // 1 Account
    firstName: z.string().min(1, 'Required'),
    lastName: z.string().min(1, 'Required'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
    // 2 Application
    applicantType: z.enum(['transfer_applicant', 'admitted_transfer', 'current_student', 'dual_enrollment'], { message: 'Choose one' }),
    targetInstitutionId: z.string().min(1, 'Choose a university'),
    intendedAcademicUnitId: z.string().optional(),
    targetProgramId: z.string().optional(),
    entryTerm: z.string().optional(),
    entryYear: yearStr,
    buid: z.string().optional().refine((v) => !v || /^U\d{8}$/.test(v), 'BUID looks like U12345678'),
    // 3 Contact
    mobile: z.string().optional(),
    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    countryOfOrigin: z.string().optional(),
    // 4 Education
    education: z
      .array(
        z.object({
          institutionName: z.string().min(1, 'Required'),
          city: z.string().optional(),
          stateRegion: z.string().optional(),
          country: z.string().optional(),
          isOutsideUS: z.boolean().optional(),
          fromYear: yearStr,
          toYear: yearStr,
          creditsEarned: z.string().optional(),
          fullTime: z.boolean().optional(),
        }),
      )
      .max(15),
    highestEducationLevel: z.string().optional(),
    fieldOfStudy: z.string().optional(),
    gpa: z.string().optional().refine((v) => !v || (Number(v) >= 0 && Number(v) <= 4.33), '0 to 4.33'),
    highSchoolName: z.string().optional(),
    highSchoolGradYear: yearStr,
    exams: z
      .array(z.object({ examType: z.enum(['AP', 'IB', 'A-level']), subject: z.string().min(1, 'Required'), score: z.string().optional(), examYear: yearStr }))
      .max(40),
    // 5 Language & international
    isNativeEnglish: z.enum(['yes', 'no']).optional(),
    englishTestType: z.string().optional(),
    englishTestScore: z.string().optional(),
    hasIntlCoursework: z.enum(['yes', 'no']).optional(),
  })
  .superRefine((v, ctx) => {
    const transfer = v.applicantType === 'transfer_applicant' || v.applicantType === 'admitted_transfer';
    if (transfer && !v.intendedAcademicUnitId) {
      ctx.addIssue({ code: 'custom', path: ['intendedAcademicUnitId'], message: 'Transfer students must choose a school or college (no undeclared applications)' });
    }
    if (transfer && !v.entryTerm) ctx.addIssue({ code: 'custom', path: ['entryTerm'], message: 'Choose your entry term' });
    if (transfer && !v.entryYear) ctx.addIssue({ code: 'custom', path: ['entryYear'], message: 'Required' });
    if (v.applicantType === 'current_student' && !v.buid) ctx.addIssue({ code: 'custom', path: ['buid'], message: 'Current students need their BUID' });
    if (v.applicantType !== 'current_student' && v.education.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['education'], message: 'Add every college you have attended' });
    }
    if (!v.isNativeEnglish) ctx.addIssue({ code: 'custom', path: ['isNativeEnglish'], message: 'Choose one' });
    if (!v.hasIntlCoursework) ctx.addIssue({ code: 'custom', path: ['hasIntlCoursework'], message: 'Choose one' });
    if (v.isNativeEnglish === 'no' && !v.englishTestType) ctx.addIssue({ code: 'custom', path: ['englishTestType'], message: 'Choose your English test' });
  });
type FormData = z.infer<typeof schema>;

const STEPS: { title: string; fields: FieldPath<FormData>[] }[] = [
  { title: 'Account', fields: ['firstName', 'lastName', 'email', 'password'] },
  { title: 'Application', fields: ['applicantType', 'targetInstitutionId', 'intendedAcademicUnitId', 'targetProgramId', 'entryTerm', 'entryYear', 'buid'] },
  { title: 'Contact', fields: ['mobile', 'emergencyContactName', 'emergencyContactPhone', 'addressLine1', 'city', 'country'] },
  { title: 'Education', fields: ['education', 'gpa', 'highSchoolName', 'highSchoolGradYear', 'exams'] },
  { title: 'Language', fields: ['isNativeEnglish', 'englishTestType', 'englishTestScore', 'hasIntlCoursework'] },
  { title: 'Review', fields: [] },
];

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass = 'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors';
const num = (v?: string) => (v ? Number(v) : undefined);

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [step, setStep] = useState(0);
  const [showPass, setShowPass] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, watch, setValue, trigger, control, getValues, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { education: [], exams: [] },
    mode: 'onTouched',
  });
  const edu = useFieldArray({ control, name: 'education' });
  const exams = useFieldArray({ control, name: 'exams' });

  const applicantType = watch('applicantType');
  const targetInstitutionId = watch('targetInstitutionId');
  const nativeEnglish = watch('isNativeEnglish');
  const intl = watch('hasIntlCoursework');
  const transfer = applicantType === 'transfer_applicant' || applicantType === 'admitted_transfer';

  const { data: universitiesData, isLoading: loadingUniversities } = useQuery({ queryKey: ['public-universities'], queryFn: () => authApi.publicUniversities() });
  const universities = universitiesData?.data ?? [];
  const { data: programsData } = useQuery({
    queryKey: ['public-programs', targetInstitutionId],
    queryFn: () => authApi.publicPrograms(Number(targetInstitutionId)),
    enabled: !!targetInstitutionId,
  });
  const programs = programsData?.data ?? [];
  const { data: unitsData } = useQuery({
    queryKey: ['public-units', targetInstitutionId],
    queryFn: () => authApi.publicAcademicUnits(Number(targetInstitutionId)),
    enabled: !!targetInstitutionId,
  });
  const units = unitsData?.data ?? [];

  // Default the target to BU once universities load.
  useEffect(() => {
    if (!getValues('targetInstitutionId') && universities.length) {
      const bu = universities.find((u) => u.code === 'BU');
      if (bu) setValue('targetInstitutionId', String(bu.id));
    }
  }, [universities, getValues, setValue]);

  // An institution flagged "outside the US" implies international coursework.
  const eduValues = watch('education');
  useEffect(() => {
    if (eduValues?.some((e) => e.isOutsideUS)) setValue('hasIntlCoursework', 'yes');
  }, [eduValues, setValue]);

  const next = async () => {
    const ok = await trigger(STEPS[step].fields);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const onSubmit = async (d: FormData) => {
    setServerError('');
    try {
      const res = await authApi.register({
        email: d.email,
        password: d.password,
        firstName: d.firstName,
        lastName: d.lastName,
        mobile: d.mobile || undefined,
        emergencyContactName: d.emergencyContactName || undefined,
        emergencyContactPhone: d.emergencyContactPhone || undefined,
        addressLine1: d.addressLine1 || undefined,
        addressLine2: d.addressLine2 || undefined,
        city: d.city || undefined,
        state: d.state || undefined,
        zipCode: d.zipCode || undefined,
        country: d.country || undefined,
        countryOfOrigin: d.countryOfOrigin || undefined,
        priorInstitutionName: d.education[d.education.length - 1]?.institutionName || undefined,
        highestEducationLevel: d.highestEducationLevel || undefined,
        fieldOfStudy: d.fieldOfStudy || undefined,
        gpa: num(d.gpa),
        targetInstitutionId: num(d.targetInstitutionId),
        targetProgramId: num(d.targetProgramId),
        applicantType: d.applicantType,
        intendedAcademicUnitId: num(d.intendedAcademicUnitId),
        entryTerm: d.entryTerm || undefined,
        entryYear: num(d.entryYear),
        buid: d.buid || undefined,
        isNativeEnglish: d.isNativeEnglish === 'yes',
        englishTestType: d.isNativeEnglish === 'no' ? d.englishTestType || undefined : undefined,
        englishTestScore: d.isNativeEnglish === 'no' ? d.englishTestScore || undefined : undefined,
        hasIntlCoursework: d.hasIntlCoursework === 'yes',
        highSchoolName: d.highSchoolName || undefined,
        highSchoolGradYear: num(d.highSchoolGradYear),
        creditsCompleted: d.education.reduce((n, e) => n + (Number(e.creditsEarned) || 0), 0) || undefined,
        education: d.education.map((e) => ({
          institutionName: e.institutionName,
          city: e.city || undefined,
          stateRegion: e.stateRegion || undefined,
          country: e.country || undefined,
          isOutsideUS: !!e.isOutsideUS,
          fromYear: num(e.fromYear),
          toYear: num(e.toYear),
          creditsEarned: num(e.creditsEarned),
          fullTime: e.fullTime,
        })),
        exams: d.exams.map((x) => ({ examType: x.examType, subject: x.subject, score: x.score || undefined, examYear: num(x.examYear) })),
      });
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      navigate('/student');
    } catch (e) {
      const err = e as AxiosError<ApiError>;
      const m = err.response?.data?.message;
      setServerError((Array.isArray(m) ? m.join(' ') : m) ?? 'Registration failed. Please try again.');
    }
  };

  const v = watch();
  const uni = universities.find((u) => String(u.id) === v.targetInstitutionId);
  const unit = units.find((u) => String(u.id) === v.intendedAcademicUnitId);
  const credits = (v.education ?? []).reduce((n, e) => n + (Number(e.creditsEarned) || 0), 0);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 p-4 py-10">
      <motion.div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-brand-700/40 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute -bottom-40 -right-20 h-[36rem] w-[36rem] rounded-full bg-brand-500/30 blur-3xl" animate={{ x: [0, -30, 0], y: [0, -40, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }} />

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative w-full max-w-3xl">
        <div className="mb-6 text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-lg"><GraduationCap className="text-brand-800" size={28} /></div>
          <h1 className="text-2xl font-bold text-white">TransferHub</h1>
          <p className="mt-1 text-brand-200">Create your student account</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/20 sm:p-8">
          {/* Stepper */}
          <ol className="mb-6 flex items-center gap-1 overflow-x-auto pb-1">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-center gap-1">
                <button type="button" disabled={i > step} onClick={() => setStep(i)}
                  className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
                    i === step ? 'bg-brand-800 text-white' : i < step ? 'bg-brand-50 text-brand-800' : 'bg-gray-100 text-gray-400')}>
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i < step ? 'bg-brand-800 text-white' : '')}>{i < step ? <Check size={10} /> : i + 1}</span>
                  {s.title}
                </button>
                {i < STEPS.length - 1 && <span className="h-px w-3 bg-gray-200" />}
              </li>
            ))}
          </ol>

          {serverError && (
            <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="shrink-0" />{serverError}</div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit, (errs) => {
              // Jump back to the first step that has a problem.
              const first = STEPS.findIndex((st) => st.fields.some((f) => f.split('.')[0] in errs));
              if (first >= 0) setStep(first);
            })}
            className="space-y-5"
          >
            {step === 0 && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="First name" error={errors.firstName?.message}><input {...register('firstName')} className={inputClass} /></Field>
                  <Field label="Last name" error={errors.lastName?.message}><input {...register('lastName')} className={inputClass} /></Field>
                </div>
                <Field label="Email address" error={errors.email?.message}><input {...register('email')} type="email" autoComplete="email" className={inputClass} /></Field>
                <Field label="Password" error={errors.password?.message}>
                  <div className="relative">
                    <input {...register('password')} type={showPass ? 'text' : 'password'} autoComplete="new-password" className={`${inputClass} pr-11`} placeholder="At least 8 characters" />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">{showPass ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                  </div>
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <Field label="Which describes you?" error={errors.applicantType?.message}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {APPLICANT_TYPES.map((t) => (
                      <label key={t.value} className={cn('cursor-pointer rounded-lg border p-3 text-sm', applicantType === t.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300')}>
                        <input type="radio" value={t.value} {...register('applicantType')} className="sr-only" />
                        <span className="block font-medium text-gray-900">{t.label}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">{t.help}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="University" error={errors.targetInstitutionId?.message}>
                    <select {...register('targetInstitutionId')} className={inputClass} disabled={loadingUniversities}>
                      <option value="">{loadingUniversities ? 'Loading…' : 'Select…'}</option>
                      {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                  <Field label={transfer ? 'School or college' : 'School or college (optional)'} error={errors.intendedAcademicUnitId?.message} hint={transfer ? 'Required: BU does not accept undeclared transfer applications.' : undefined}>
                    <select {...register('intendedAcademicUnitId')} className={inputClass} disabled={!targetInstitutionId}>
                      <option value="">{units.length ? 'Select…' : 'No schools listed'}</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Intended program (optional)">
                    <select {...register('targetProgramId')} className={inputClass} disabled={!targetInstitutionId}>
                      <option value="">Select…</option>
                      {programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.degree ? ` (${p.degree})` : ''}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={transfer ? 'Entry term' : 'Entry term (optional)'} error={errors.entryTerm?.message}>
                      <select {...register('entryTerm')} className={inputClass}>
                        <option value="">Select…</option><option value="fall">Fall</option><option value="spring">Spring</option><option value="summer">Summer</option>
                      </select>
                    </Field>
                    <Field label="Year" error={errors.entryYear?.message}><input {...register('entryYear')} inputMode="numeric" className={inputClass} placeholder="2027" /></Field>
                  </div>
                  <Field label={applicantType === 'current_student' ? 'BUID' : 'BUID (if you have one)'} error={errors.buid?.message}>
                    <input {...register('buid')} className={inputClass} placeholder="U12345678" />
                  </Field>
                </div>
                {applicantType === 'transfer_applicant' && (
                  <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><Info size={14} className="mt-0.5 shrink-0" />BU only evaluates transfer credit after admission. Until then, anything you submit gives a preview based on BU's equivalency database, not a guarantee.</p>
                )}
              </>
            )}

            {step === 2 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mobile number"><input {...register('mobile')} className={inputClass} /></Field>
                <Field label="Emergency contact name"><input {...register('emergencyContactName')} className={inputClass} /></Field>
                <Field label="Emergency contact phone"><input {...register('emergencyContactPhone')} className={inputClass} /></Field>
                <Field label="Address line 1"><input {...register('addressLine1')} className={inputClass} /></Field>
                <Field label="Address line 2"><input {...register('addressLine2')} className={inputClass} /></Field>
                <Field label="City"><input {...register('city')} className={inputClass} /></Field>
                <Field label="State / Province"><input {...register('state')} className={inputClass} /></Field>
                <Field label="Zip / postal code"><input {...register('zipCode')} className={inputClass} /></Field>
                <Field label="Country"><input {...register('country')} className={inputClass} /></Field>
                <Field label="Country of origin"><input {...register('countryOfOrigin')} className={inputClass} /></Field>
              </div>
            )}

            {step === 3 && (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Every college or university you have attended</span>
                    <button type="button" onClick={() => edu.append({ institutionName: '', fullTime: true })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><Plus size={14} /> Add</button>
                  </div>
                  {errors.education?.message && <p className="mb-2 text-xs text-red-600">{errors.education.message}</p>}
                  <div className="space-y-3">
                    {edu.fields.map((f, i) => (
                      <div key={f.id} className="rounded-lg border border-gray-200 p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                          <div className="sm:col-span-3">
                            <input {...register(`education.${i}.institutionName`)} list="known-colleges" className={inputClass} placeholder="College / university name" />
                            {errors.education?.[i]?.institutionName && <p className="mt-1 text-xs text-red-600">Required</p>}
                          </div>
                          <input {...register(`education.${i}.city`)} className={`${inputClass} sm:col-span-1`} placeholder="City" />
                          <input {...register(`education.${i}.stateRegion`)} className={`${inputClass} sm:col-span-1`} placeholder="State" />
                          <input {...register(`education.${i}.country`)} className={`${inputClass} sm:col-span-1`} placeholder="Country" />
                          <input {...register(`education.${i}.fromYear`)} inputMode="numeric" className={`${inputClass} sm:col-span-1`} placeholder="From (year)" />
                          <input {...register(`education.${i}.toYear`)} inputMode="numeric" className={`${inputClass} sm:col-span-1`} placeholder="To (year)" />
                          <input {...register(`education.${i}.creditsEarned`)} inputMode="decimal" className={`${inputClass} sm:col-span-1`} placeholder="Credits earned" />
                          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-1"><input type="checkbox" {...register(`education.${i}.fullTime`)} className="h-4 w-4 rounded border-gray-300" /> Full-time</label>
                          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-1"><input type="checkbox" {...register(`education.${i}.isOutsideUS`)} className="h-4 w-4 rounded border-gray-300" /> Outside the US</label>
                          <button type="button" onClick={() => edu.remove(i)} className="flex items-center justify-end text-gray-400 hover:text-red-600 sm:col-span-1" aria-label="Remove"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <datalist id="known-colleges">{universities.map((u) => <option key={u.id} value={u.name} />)}</datalist>
                  {credits > 0 && <p className="mt-2 text-xs text-gray-500">{credits} college credits listed. BU typically expects at least 12, completed as a full-time degree student.</p>}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Highest education level">
                    <select {...register('highestEducationLevel')} className={inputClass}>
                      <option value="">Select…</option><option>High School</option><option>Associate's</option><option>Bachelor's</option><option>Master's</option><option>Other</option>
                    </select>
                  </Field>
                  <Field label="Field of study"><input {...register('fieldOfStudy')} className={inputClass} /></Field>
                  <Field label="Cumulative college GPA" error={errors.gpa?.message}><input {...register('gpa')} inputMode="decimal" className={inputClass} placeholder="3.50" /></Field>
                  <Field label="High school"><input {...register('highSchoolName')} className={inputClass} /></Field>
                  <Field label="High school graduation year" error={errors.highSchoolGradYear?.message}><input {...register('highSchoolGradYear')} inputMode="numeric" className={inputClass} /></Field>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">AP, IB or A-level exams <span className="font-normal text-gray-400">(count toward BU's limit on outside credit)</span></span>
                    <button type="button" onClick={() => exams.append({ examType: 'AP', subject: '' })} className="inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><Plus size={14} /> Add exam</button>
                  </div>
                  <div className="space-y-2">
                    {exams.fields.map((f, i) => (
                      <div key={f.id} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                        <select {...register(`exams.${i}.examType`)} className={inputClass}><option>AP</option><option>IB</option><option>A-level</option></select>
                        <input {...register(`exams.${i}.subject`)} className={`${inputClass} sm:col-span-3`} placeholder="Subject, e.g. Calculus BC" />
                        <input {...register(`exams.${i}.score`)} className={inputClass} placeholder="Score" />
                        <div className="flex gap-2">
                          <input {...register(`exams.${i}.examYear`)} inputMode="numeric" className={inputClass} placeholder="Year" />
                          <button type="button" onClick={() => exams.remove(i)} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <Field label="Is English your first language?" error={errors.isNativeEnglish?.message}>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" value="yes" {...register('isNativeEnglish')} /> Yes</label>
                    <label className="flex items-center gap-2"><input type="radio" value="no" {...register('isNativeEnglish')} /> No</label>
                  </div>
                </Field>
                {nativeEnglish === 'no' && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="English proficiency test" error={errors.englishTestType?.message}>
                      <select {...register('englishTestType')} className={inputClass}><option value="">Select…</option><option value="TOEFL">TOEFL iBT</option><option value="IELTS">IELTS</option><option value="Duolingo">Duolingo English Test</option></select>
                    </Field>
                    <Field label="Score (if you have it)"><input {...register('englishTestScore')} className={inputClass} /></Field>
                  </div>
                )}
                <Field label="Did you complete any college coursework outside the United States?" error={errors.hasIntlCoursework?.message}>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="radio" value="yes" {...register('hasIntlCoursework')} /> Yes</label>
                    <label className="flex items-center gap-2"><input type="radio" value="no" {...register('hasIntlCoursework')} /> No</label>
                  </div>
                </Field>
                {intl === 'yes' && (
                  <div className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <Globe2 size={18} className="mt-0.5 shrink-0" />
                    <span>
                      Coursework taken outside the US before you enrol is evaluated by BU's <strong>Office of International Undergraduate Admissions</strong>
                      {' '}(<a className="underline" href="mailto:intadvis@bu.edu">intadvis@bu.edu</a>, 881 Commonwealth Ave, Boston). You can still list it here;
                      it will be flagged for that office instead of being evaluated in TransferHub.
                    </span>
                  </div>
                )}
              </>
            )}

            {step === 5 && (
              <div className="space-y-4 text-sm">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div><dt className="text-gray-500">Name</dt><dd className="font-medium text-gray-900">{v.firstName} {v.lastName} · {v.email}</dd></div>
                  <div><dt className="text-gray-500">Applying as</dt><dd className="font-medium text-gray-900">{APPLICANT_TYPES.find((t) => t.value === v.applicantType)?.label}</dd></div>
                  <div><dt className="text-gray-500">University / school</dt><dd className="font-medium text-gray-900">{uni?.name ?? '—'}{unit ? ` · ${unit.name}` : ''}</dd></div>
                  <div><dt className="text-gray-500">Entry</dt><dd className="font-medium text-gray-900">{v.entryTerm ? `${v.entryTerm} ${v.entryYear ?? ''}` : '—'}</dd></div>
                  <div><dt className="text-gray-500">Colleges attended</dt><dd className="font-medium text-gray-900">{(v.education ?? []).map((e) => e.institutionName).filter(Boolean).join(', ') || '—'}</dd></div>
                  <div><dt className="text-gray-500">Exams</dt><dd className="font-medium text-gray-900">{(v.exams ?? []).length ? (v.exams ?? []).map((x) => `${x.examType} ${x.subject}`).join(', ') : 'None'}</dd></div>
                </dl>
                <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  <p><strong>How BU counts transfer credit:</strong> courses need a grade of C or better from a regionally accredited college; Pass/Fail is not normally accepted; at most 68 outside credits count (60 for first-year entrants), including AP/IB/A-level; coursework older than five years gets extra review.</p>
                  <p><strong>BU Hub:</strong> transfer courses never count toward Hub requirements. Transfer students complete 10 Hub requirements at BU.</p>
                  {applicantType === 'transfer_applicant' && <p><strong>Before admission</strong> you see a preview only. The official evaluation happens once you are admitted.</p>}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {step > 0 ? (
                <button type="button" onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={16} /> Back</button>
              ) : <span />}
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={() => void next()} icon={<ArrowRight size={16} />}>Continue</Button>
              ) : (
                <Button type="submit" disabled={isSubmitting} icon={!isSubmitting ? <ArrowRight size={16} /> : undefined}>{isSubmitting ? 'Creating account…' : 'Create account'}</Button>
              )}
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account? <Link to="/login" className="font-medium text-brand-800 hover:underline">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
