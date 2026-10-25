import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, KeyRound, Upload, Zap } from 'lucide-react';
import { importApi } from '../../lib/api';
import { cn } from '../../lib/cn';
import SubmissionsPanel from '../../components/import/SubmissionsPanel';
import PartnersPanel from '../../components/import/PartnersPanel';
import DirectImport from '../../components/import/DirectImport';

type Tab = 'submissions' | 'partners' | 'direct';

export default function DataImport() {
  const [tab, setTab] = useState<Tab>('submissions');
  // Badge on the Submissions tab: how many submissions are waiting for a person.
  const open = useQuery({ queryKey: ['import-batches', 'open'], queryFn: () => importApi.batches({ status: 'open' }), refetchInterval: 60_000 });
  const waiting = open.data?.data.length ?? 0;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'submissions', label: 'Submissions', icon: <Inbox size={15} />, badge: waiting },
    { key: 'partners', label: 'Partners & API keys', icon: <KeyRound size={15} /> },
    { key: 'direct', label: 'Direct import', icon: <Zap size={15} /> },
  ];

  return (
    <div className="mx-auto w-[95%] p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Upload className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Import</h1>
          <p className="text-sm text-gray-500">Receive universities, programs and courses from partners, review them row by row, and import only what you approve.</p>
        </div>
      </div>

      <div className="mb-6 inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 font-medium', tab === t.key ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-50')}>
            {t.icon} {t.label}
            {!!t.badge && <span className={cn('rounded-full px-1.5 text-xs', tab === t.key ? 'bg-white/25' : 'bg-amber-100 text-amber-700')}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'submissions' && <SubmissionsPanel />}
      {tab === 'partners' && <PartnersPanel />}
      {tab === 'direct' && <DirectImport />}
    </div>
  );
}
