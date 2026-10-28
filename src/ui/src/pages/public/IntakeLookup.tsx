import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, CheckCircle2, FlaskConical, Search } from 'lucide-react';
import { AxiosError } from 'axios';
import { authApi, intakeApi, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';

import { LogoTile } from '../../components/shared/Logo';
const inputClass = 'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors';

export function IntakeShell({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 p-4 py-10">
      <motion.div className="absolute -left-32 -top-32 h-[32rem] w-[32rem] rounded-full bg-brand-700/40 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute -bottom-40 -right-20 h-[36rem] w-[36rem] rounded-full bg-brand-500/30 blur-3xl" animate={{ x: [0, -30, 0], y: [0, -40, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="mb-6 text-center">
          <Link to="/" aria-label="TransferHub home"><LogoTile width={220} className="mb-3" /></Link>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-brand-200">{subtitle}</p>}
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/20 sm:p-8">{children}</div>
      </motion.div>
    </div>
  );
}

export default function IntakeLookup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [idNumber, setIdNumber] = useState(params.get('id') ?? '');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [uni, setUni] = useState(params.get('uni') ?? '');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ message: string; claimUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ['public-universities'], queryFn: () => authApi.publicUniversities() });
  const universities = data?.data ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await intakeApi.lookup({ idNumber: idNumber.trim(), email: email.trim(), universityCode: uni || undefined, channel: params.get('ch') ?? 'link' });
      setDone({ message: res.data.message, claimUrl: res.data.demo?.claimUrl });
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 429) setError('Too many attempts. Please wait a few minutes and try again.');
      else setError(getErrorMessage(err, 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const openDemo = (url: string) => {
    try {
      const u = new URL(url, window.location.origin);
      navigate(`${u.pathname}${u.search}`);
    } catch {
      navigate(url);
    }
  };

  return (
    <IntakeShell title="Find your records" subtitle="Bring your previous university data into TransferHub">
      {done ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
            <p>{done.message}</p>
          </div>
          {done.claimUrl && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900"><FlaskConical size={16} /> Demo mode</p>
              <p className="mb-3 text-xs text-amber-800">This is a sample record, so no real email is sent. Use the button to continue as if you clicked the emailed link.</p>
              <Button type="button" onClick={() => openDemo(done.claimUrl!)} icon={<ArrowRight size={16} />}>Open my record</Button>
            </div>
          )}
          <button type="button" onClick={() => setDone(null)} className="text-sm text-gray-500 hover:text-gray-800">Search again</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-500">Enter the ID your previous university knows you by and the email address on your record. If we find a match, we send a secure link to that email so you can review and confirm your data.</p>
          {error && <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={18} className="shrink-0" />{error}</div>}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Your ID</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required className={inputClass} placeholder="e.g. NU-1234567" autoComplete="off" />
            <p className="mt-1 text-xs text-gray-400">Student ID, passport number or other unique ID</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} autoComplete="email" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Previous university <span className="font-normal text-gray-400">(optional)</span></label>
            <select value={uni} onChange={(e) => setUni(e.target.value)} className={inputClass}>
              <option value="">Not sure / any</option>
              {universities.map((u) => <option key={u.id} value={u.code}>{u.name}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={busy || !idNumber.trim() || !email.trim()} icon={<Search size={16} />} className="w-full">{busy ? 'Searching…' : 'Find my records'}</Button>
          <p className="text-center text-sm text-gray-500">
            Prefer to type everything yourself? <Link to="/register" className="font-medium text-brand-800 hover:underline">Create an account</Link>
          </p>
        </form>
      )}
    </IntakeShell>
  );
}
