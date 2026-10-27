/**
 * PRG-02: all transfer credit must be transferred within ONE YEAR of starting at the university.
 * Pure date logic, no database: see CreditDeadlineService for the lookups and the test script
 * (scripts/test-credit-deadline.ts) for the expected behaviour.
 *
 * Documented default term start dates (BU-like; the per-student StartDate column overrides them):
 *   Fall   = 1 September of the entry year
 *   Spring = 15 January
 *   Summer = 25 May
 * The deadline is the start date plus `months` calendar months (12 by default; configurable per
 * university). A start on 29 Feb or the 31st clamps to the last day of the target month. The
 * deadline day itself still counts as on time (0 days left); the day after is overdue.
 * All arithmetic is on UTC calendar dates, so the result never depends on the server time zone.
 */

export type DeadlineState = 'not_started' | 'on_track' | 'due_soon' | 'urgent' | 'overdue' | 'unknown';
/** Where the start date came from. 'estimate' = month count from the first request (no entry term known). */
export type DeadlineBasis = 'start_date' | 'entry_term' | 'estimate' | 'none';

export const TERM_STARTS: Record<string, { month: number; day: number }> = {
  fall: { month: 9, day: 1 },
  spring: { month: 1, day: 15 },
  summer: { month: 5, day: 25 },
};

export const DUE_SOON_DAYS = 90;
export const URGENT_DAYS = 30;
/** Reminder thresholds, most urgent last. 'overdue' is sent once the deadline has passed. */
export const NOTICE_THRESHOLDS = ['90', '30', '7', 'overdue'] as const;
export type NoticeThreshold = (typeof NOTICE_THRESHOLDS)[number];

export interface CreditDeadlineInput {
  entryTerm?: string | null;
  entryYear?: number | null;
  /** The actual start date when known (wins over the term default). */
  startDate?: Date | string | null;
  months?: number | null;
  now?: Date;
  /** Only used when no entry term/start date is known: the first (non-preview) request, as an estimate. */
  firstRequestAt?: Date | string | null;
}

export interface CreditDeadline {
  startsOn: string | null; // YYYY-MM-DD
  deadlineOn: string | null; // YYYY-MM-DD
  daysLeft: number | null; // negative once overdue
  state: DeadlineState;
  basis: DeadlineBasis;
  isEstimate: boolean;
  months: number;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Truncates a Date or ISO/date string to its UTC calendar day; null when unparsable. */
function toDay(v: Date | string | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  return utcDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Adds calendar months, clamping the day (31 Aug + 6 months = 28/29 Feb, 29 Feb + 12 months = 28 Feb). */
export function addMonths(d: Date, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12; // 0-based
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

/** The reminder bucket for a number of days left: the most urgent threshold already crossed, or null. */
export function thresholdFor(daysLeft: number | null): NoticeThreshold | null {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 7) return '7';
  if (daysLeft <= 30) return '30';
  if (daysLeft <= 90) return '90';
  return null;
}

export function computeCreditDeadline(input: CreditDeadlineInput): CreditDeadline {
  const months = input.months != null && Number.isFinite(Number(input.months)) && Number(input.months) > 0 ? Math.round(Number(input.months)) : 12;
  const now = toDay(input.now ?? new Date())!;

  let start: Date | null = null;
  let basis: DeadlineBasis = 'none';
  const explicit = toDay(input.startDate);
  const term = TERM_STARTS[(input.entryTerm ?? '').trim().toLowerCase()];
  if (explicit) {
    start = explicit;
    basis = 'start_date';
  } else if (term && input.entryYear && Number.isInteger(Number(input.entryYear)) && Number(input.entryYear) > 1900) {
    start = utcDay(Number(input.entryYear), term.month, term.day);
    basis = 'entry_term';
  } else {
    const first = toDay(input.firstRequestAt);
    if (first) {
      start = first;
      basis = 'estimate';
    }
  }

  if (!start) return { startsOn: null, deadlineOn: null, daysLeft: null, state: 'unknown', basis: 'none', isEstimate: false, months };

  const deadline = addMonths(start, months);
  const daysLeft = Math.round((deadline.getTime() - now.getTime()) / DAY);
  let state: DeadlineState;
  if (daysLeft < 0) state = 'overdue';
  else if (now.getTime() < start.getTime()) state = 'not_started';
  else if (daysLeft <= URGENT_DAYS) state = 'urgent';
  else if (daysLeft <= DUE_SOON_DAYS) state = 'due_soon';
  else state = 'on_track';

  return { startsOn: iso(start), deadlineOn: iso(deadline), daysLeft, state, basis, isEstimate: basis === 'estimate', months };
}
