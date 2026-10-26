import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Copy, Download, ExternalLink, ScanLine, Send } from 'lucide-react';
import { intakeApi, type IntakeOverview } from '../../lib/api';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';

type DemoRow = IntakeOverview['demoProfiles'][number];
type SessionRow = IntakeOverview['recentSessions'][number];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {done ? <Check size={15} className="text-green-600" /> : <Copy size={15} />} {done ? 'Copied' : label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-brand-100/60 bg-white p-4 shadow-sm shadow-brand-900/5">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

const badge = (ok: boolean, yes: string, no: string) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{ok ? yes : no}</span>
);

export default function IntakeAdmin() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['intake-overview'], queryFn: async () => (await intakeApi.adminOverview()).data });
  const [qr, setQr] = useState('');
  const shareUrl = data?.shareUrl ?? `${window.location.origin}/intake`;

  useEffect(() => {
    QRCode.toDataURL(shareUrl, { width: 320, margin: 2, color: { dark: '#770816', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [shareUrl]);

  const emailTemplate = useMemo(
    () =>
      `Subject: Bring your university records into TransferHub\n\nHello,\n\nPlanning to transfer? Use this link to find your records from your previous university. Enter your student ID (or passport number) and your email address, and we will send you a secure link to review and confirm your details:\n\n${shareUrl}\n\nThe TransferHub team`,
    [shareUrl],
  );
  const mailto = `mailto:?subject=${encodeURIComponent('Bring your university records into TransferHub')}&body=${encodeURIComponent(emailTemplate.split('\n\n').slice(1).join('\n\n'))}`;

  const invite = useMutation({
    mutationFn: (id: number) => intakeApi.adminInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intake-overview'] }),
  });

  const demoCols: DataTableColumn<DemoRow>[] = [
    { key: 'externalId', header: 'ID', render: (r) => <span className="font-medium">{r.externalId}</span> },
    { key: 'idType', header: 'Type', render: (r) => r.idType.replace(/_/g, ' ') },
    { key: 'name', header: 'Name', sortValue: (r) => `${r.firstName} ${r.lastName}`, render: (r) => `${r.firstName} ${r.lastName}` },
    { key: 'email', header: 'Email' },
    { key: 'institutionCode', header: 'Source university' },
    { key: 'claimed', header: 'Status', render: (r) => badge(r.claimed, 'Claimed', 'Unclaimed') },
    {
      key: 'actions', header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <a
            href={`/intake?id=${encodeURIComponent(r.externalId)}&email=${encodeURIComponent(r.email)}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline"
          >
            <ExternalLink size={12} /> Try it
          </a>
          {!r.claimed && (
            <button onClick={() => invite.mutate(r.id)} disabled={invite.isPending} className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:underline disabled:opacity-50">
              <Send size={12} /> Send invite
            </button>
          )}
        </div>
      ),
    },
  ];

  const sessionCols: DataTableColumn<SessionRow>[] = [
    { key: 'email', header: 'Email' },
    { key: 'institutionCode', header: 'Source university' },
    { key: 'channel', header: 'Channel', render: (r) => r.channel.replace(/_/g, ' ') },
    { key: 'status', header: 'Status', render: (r) => badge(r.status === 'claimed', 'Claimed', r.status) },
    { key: 'createdAt', header: 'Started', sortValue: (r) => r.createdAt, render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: 'claimedAt', header: 'Claimed', render: (r) => (r.claimedAt ? new Date(r.claimedAt).toLocaleString() : '-') },
  ];

  const counts = data?.counts;

  return (
    <div className="mx-auto w-[95%] p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <ScanLine className="text-brand-800" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Student intake</h1>
          <p className="text-sm text-gray-500">Let students pull their records from their previous university with a link or QR code</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold text-gray-900">Share link</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={shareUrl} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={shareUrl} label="Copy link" />
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-gray-900">Email template</h3>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{emailTemplate}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={emailTemplate} label="Copy email" />
            <a href={mailto} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900"><Send size={15} /> Open in mail app</a>
          </div>
        </div>
        <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-white p-5 text-center">
          <h2 className="mb-3 font-semibold text-gray-900">QR code</h2>
          {qr ? <img src={qr} alt="QR code for the student intake link" className="h-48 w-48 rounded-lg border border-gray-100" /> : <div className="h-48 w-48 rounded-lg bg-gray-100" />}
          <a href={qr} download="transferhub-intake-qr.png" className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${qr ? '' : 'pointer-events-none opacity-50'}`}>
            <Download size={15} /> Download PNG
          </a>
          <p className="mt-2 text-xs text-gray-400">Print it on flyers or show it at events.</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Source profiles" value={counts?.profiles ?? 0} />
        <Stat label="Demo profiles" value={counts?.mockProfiles ?? 0} />
        <Stat label="Open links" value={counts?.openSessions ?? 0} />
        <Stat label="Accounts claimed" value={counts?.claimed ?? 0} />
      </div>

      <h2 className="mb-3 font-semibold text-gray-900">Demo profiles</h2>
      <p className="mb-3 text-sm text-gray-500">Sample records standing in for a real university system. Use &quot;Try it&quot; to walk through the student experience.</p>
      <div className="mb-8">
        <DataTable<DemoRow>
          columns={demoCols} rows={(data?.demoProfiles ?? []).map((r) => ({ ...r, id: r.id }))} isLoading={isLoading} pageSize={10}
          searchPlaceholder="Search demo profiles…" searchKeys={['externalId', 'email', 'firstName', 'lastName', 'institutionCode']}
          showExport={false} emptyMessage="No demo profiles yet. Apply seed 013."
        />
      </div>

      <h2 className="mb-3 font-semibold text-gray-900">Recent activity</h2>
      <DataTable<SessionRow>
        columns={sessionCols} rows={data?.recentSessions ?? []} isLoading={isLoading} pageSize={10}
        searchKeys={['email', 'institutionCode', 'channel', 'status']} showExport={false} emptyMessage="No intake activity yet."
      />
    </div>
  );
}
