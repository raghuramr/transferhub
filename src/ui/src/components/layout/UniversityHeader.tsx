import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetUrl, accountApi, type UniversityBrand } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

const STORE_KEY = 'th.header.university';

function Initials({ name }: { name: string }) {
  const t = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className="text-lg font-bold text-brand-800">{t || 'U'}</span>;
}

/**
 * A band across the top of the app for admins and faculty who belong to a university: its banner image as the
 * background, its logo and its name. Shown only when the user is scoped to at least one university (set under
 * Users); everyone else keeps the plain TransferHub shell. With several universities the user picks which one to show.
 */
export function UniversityHeader() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === 'admin' || user?.role === 'faculty';
  const { data } = useQuery({
    queryKey: ['university-brand', user?.id],
    queryFn: async () => (await accountApi.universityBrand()).data.universities,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [chosenId, setChosenId] = useState<number | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v) setChosenId(Number(v));
    } catch { /* storage unavailable: fall back to the first university */ }
  }, []);

  const list: UniversityBrand[] = data ?? [];
  if (!enabled || list.length === 0) return null;
  const uni = list.find((u) => u.id === chosenId) ?? list[0];
  const banner = assetUrl(uni.heroImageUrl);
  const logo = assetUrl(uni.logoUrl);

  return (
    <header
      className="relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden px-4 py-3 text-white sm:flex-nowrap sm:px-6 sm:py-4"
      style={banner ? { backgroundImage: `url("${banner}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      aria-label={`${uni.name} header`}
      data-testid="university-header"
    >
      {/* Keeps the text readable on any banner; with no banner this is the whole background. */}
      <div className={banner ? 'absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/10' : 'absolute inset-0 bg-gradient-to-r from-brand-900 to-brand-700'} />
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-black/10 sm:h-14 sm:w-14">
        {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-1" /> : <Initials name={uni.name} />}
      </div>
      <div className="relative min-w-0 flex-1 basis-40">
        <p className="text-base font-bold leading-tight drop-shadow sm:truncate sm:text-xl">{uni.name}</p>
        <p className="truncate text-xs text-white/80 sm:text-sm">
          {uni.code} · {user?.role === 'faculty' ? 'Faculty' : 'Administration'}
        </p>
      </div>
      {list.length > 1 && (
        <label className="relative w-full shrink-0 text-xs text-white/90 sm:w-auto">
          <span className="sr-only">Switch university</span>
          <select
            value={uni.id}
            onChange={(e) => {
              const id = Number(e.target.value);
              setChosenId(id);
              try { localStorage.setItem(STORE_KEY, String(id)); } catch { /* ignore */ }
            }}
            className="w-full rounded-lg border border-white/40 bg-black/30 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/60 sm:w-auto sm:max-w-[12rem]"
          >
            {list.map((u) => <option key={u.id} value={u.id} className="text-gray-900">{u.name}</option>)}
          </select>
        </label>
      )}
    </header>
  );
}
