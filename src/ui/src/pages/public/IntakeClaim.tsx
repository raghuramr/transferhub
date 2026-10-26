import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, FileText, Loader2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { intakeApi, getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { Button } from '../../components/ui/Button';
import { IntakeShell } from './IntakeLookup';

const inputClass = 'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors';
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Row({ k, v }: { k: string; v?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{k}</dt>
      <dd className="text-sm font-medium text-gray-900">{v ?? '-'}</dd>
    </div>
  );
}

export default function IntakeClaim() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const [mobile, setMobile] = useState('');
  const [target, setTarget] = useState('');
  const [submitEval, setSubmitEval] = useState(true);
  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['intake-session', token],
    queryFn: async () => (await intakeApi.session(token)).data,
    enabled: !!token,
    retry: false,
  });
  const s = q.data;

  const claim = useMutation({
    mutationFn: () =>
      intakeApi.claim({
        token, password, consent: true,
        targetInstitutionId: target ? Number(target) : undefined,
        mobile: mobile.trim() || undefined,
        submitForEvaluation: submitEval,
      }),
    onSuccess: (res) => {
      setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      navigate('/student');
    },
    onError: (err) => {
      if (err instanceof AxiosError && err.response?.status === 409) setError('You already have an account with this email. Please sign in instead.');
      else setError(getErrorMessage(err, 'Could not create your account. Please try again.'));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Your password needs at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    if (!consent) return setError('Please confirm the consent box to continue.');
    claim.mutate();
  };

  const failure = !token
    ? 'This link is missing its token.'
    : q.isError
      ? getErrorMessage(q.error, 'This link is invalid or has expired.')
      : '';

  if (!token || q.isError) {
    return (
      <IntakeShell title="Confirm your records">
        <div className="space-y-4 text-center">
          <AlertCircle className="mx-auto text-red-500" size={40} />
          <p className="text-sm text-gray-700">{failure}</p>
          <Link to="/intake" className="inline-block text-sm font-medium text-brand-800 hover:underline">Start again</Link>
        </div>
      </IntakeShell>
    );
  }

  if (q.isLoading || !s) {
    return (
      <IntakeShell title="Confirm your records">
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} /> Loading your record…</p>
      </IntakeShell>
    );
  }

  if (s.accountExists) {
    return (
      <IntakeShell title="Confirm your records">
        <div className="space-y-4 text-center">
          <p className="text-sm text-gray-700">You already have an account - sign in to see your records.</p>
          <Link to="/login" className="inline-block rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-900">Sign in</Link>
        </div>
      </IntakeShell>
    );
  }

  const p = s.profile;
  const totalCredits = s.courses.reduce((n, c) => n + Number(c.credits || 0), 0);

  return (
    <IntakeShell title="Confirm your records" subtitle="Check the details below, then create your account" wide>
      <form onSubmit={submit} className="space-y-6">
        {error && <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={18} className="shrink-0" />{error}</div>}

        <section>
          <h2 className="mb-3 font-semibold text-gray-900">Your details</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-2 md:grid-cols-3">
            <Row k="Name" v={`${p.firstName} ${p.lastName}`} />
            <Row k="Email" v={p.email} />
            <Row k={label(p.idType)} v={p.maskedId} />
            <Row k="Previous university" v={`${p.institutionName} (${p.institutionCode})`} />
            <Row k="Program" v={[p.programName, p.degree].filter(Boolean).join(' - ') || null} />
            <Row k="Field of study" v={p.fieldOfStudy} />
            <Row k="GPA" v={p.gpa != null ? Number(p.gpa).toFixed(2) : null} />
            <Row k="Graduation year" v={p.graduationYear} />
            <Row k="Credits completed" v={p.creditsCompleted} />
            <Row k="Country" v={p.country} />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 font-semibold text-gray-900">Courses ({s.courses.length})</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-left">Title</th><th className="px-3 py-2 text-right">Credits</th><th className="px-3 py-2 text-left">Grade</th><th className="px-3 py-2 text-left">Term</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.courses.map((c, i) => (
                  <tr key={`${c.courseCode}-${i}`}>
                    <td className="px-3 py-2 font-medium">{c.courseCode}</td>
                    <td className="px-3 py-2">{c.courseTitle}</td>
                    <td className="px-3 py-2 text-right">{c.credits}</td>
                    <td className="px-3 py-2">{c.grade}</td>
                    <td className="px-3 py-2">{c.term ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 text-sm font-semibold">
                <tr><td className="px-3 py-2" colSpan={2}>Total</td><td className="px-3 py-2 text-right">{totalCredits}</td><td colSpan={2} /></tr>
              </tfoot>
            </table>
          </div>
        </section>

        {s.documents.length > 0 && (
          <section>
            <h2 className="mb-3 font-semibold text-gray-900">Documents we will save to your profile</h2>
            <ul className="space-y-2">
              {s.documents.map((d, i) => (
                <li key={`${d.fileName}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <FileText size={16} className="text-gray-400" />
                  <span className="min-w-0 flex-1 truncate">{d.fileName}</span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">{label(d.docType)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Mobile number <span className="font-normal text-gray-400">(optional)</span></label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={inputClass} placeholder={p.phone ?? ''} autoComplete="tel" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">University you want to transfer to <span className="font-normal text-gray-400">(optional)</span></label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
              <option value="">Choose later</option>
              {s.universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Create a password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="new-password" placeholder="At least 8 characters" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="new-password" />
          </div>
        </section>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={submitEval} onChange={(e) => setSubmitEval(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
            Submit these courses for evaluation now
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
            I confirm this is my record and agree to TransferHub importing it
          </label>
        </div>

        <Button type="submit" disabled={claim.isPending} icon={!claim.isPending ? <ArrowRight size={16} /> : undefined} className="w-full sm:w-auto">
          {claim.isPending ? 'Creating your account…' : 'Confirm and create my account'}
        </Button>
      </form>
    </IntakeShell>
  );
}
