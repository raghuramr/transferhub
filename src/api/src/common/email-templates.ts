// Every TransferHub e-mail, in one place. PURE functions (no Nest, no DB) so they
// can be rendered for the preview gallery in System Settings > Email.
// Table based layout with inline CSS, 600px wide, so it renders the same in
// Outlook, Gmail and phone clients. Everything passed in is plain text; it is
// HTML-escaped here.

export const BRAND_NAME = 'TransferHub';
export const BRAND_TAGLINE = 'Transfer Credit Evaluation';

const RED = '#770816';
const RED_DARK = '#5c0712';
const ROSE = '#f3c1c8';
const GOLD = '#c9a227';
const PAPER = '#fbf6f6';
const INK = '#1f1a1b';
const MUTED = '#6b5f61';
const LINE = '#eadcde';

export interface EmailContext {
  /** Base URL of the web app (no trailing slash), used for buttons. */
  appBaseUrl: string;
  /** Address shown for replies and questions. */
  support: string;
}

export interface Email {
  subject: string;
  html: string;
  text: string;
  /** Template key, set when the e-mail came from `templates.*`. */
  key?: string;
  /** Extra recipients from the template's override (validated e-mail addresses). */
  cc?: string[];
  /** True when the super admin switched this e-mail off; `EmailService.sendEmail` then skips it. */
  suppressed?: boolean;
}

export interface Row {
  label: string;
  value: string;
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const CHIP: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: '#f1ecec', fg: '#5b4e50', border: '#ddd2d3' },
  info: { bg: '#e7eef8', fg: '#1e4a80', border: '#bfd2ea' },
  success: { bg: '#d9f0e0', fg: '#14612f', border: '#9fd3ae' },
  warning: { bg: '#fbf0d6', fg: '#7a5a06', border: '#ecd38e' },
  danger: { bg: '#f6e3e1', fg: '#9a3b34', border: '#e3b9b5' },
};

const CALLOUT: Record<Tone, { bar: string; bg: string }> = {
  neutral: { bar: GOLD, bg: '#fbf6e3' },
  info: { bar: '#3d6fb3', bg: '#eef3fa' },
  success: { bar: '#2f8a4c', bg: '#eaf6ee' },
  warning: { bar: GOLD, bg: '#fbf6e3' },
  danger: { bar: '#b9544c', bg: '#fbefed' },
};

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Short reference for a request: the first 8 hex characters of its id, upper case. */
export function refOf(id: string): string {
  return String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Subjects end with the reference ("... [Ref 1A2B3C4D]") so replies can be matched. */
export function withRef(subject: string, ref?: string): string {
  const clean = String(subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!ref || clean.toUpperCase().includes(ref.toUpperCase())) return clean;
  return `${clean} [Ref ${ref}]`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const first = (name: string | null | undefined) => (String(name ?? '').trim().split(/\s+/)[0] || 'there');

// ── building blocks ────────────────────────────────────────────

function para(html: string, extra = ''): string {
  return `<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:${INK};${extra}">${html}</p>`;
}

function callout(label: string, text: string, tone: Tone): string {
  const c = CALLOUT[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px 0;"><tr>` +
    `<td width="4" bgcolor="${c.bar}" style="width:4px;background-color:${c.bar};">&nbsp;</td>` +
    `<td bgcolor="${c.bg}" style="background-color:${c.bg};padding:12px 16px;font-family:Arial,Helvetica,sans-serif;">` +
    (label ? `<div style="font-size:12px;line-height:18px;font-weight:bold;letter-spacing:.5px;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>` : '') +
    `<div style="font-size:15px;line-height:23px;color:${INK};white-space:pre-wrap;word-break:break-word;">${esc(text)}</div></td></tr></table>`;
}

function rowsHtml(rows: Row[]): string {
  return rows.map((r) =>
    `<tr><td class="lbl" valign="top" style="padding:9px 12px 9px 0;border-top:1px solid ${LINE};font-size:13px;line-height:18px;color:${MUTED};width:38%;word-break:break-word;">${esc(r.label)}</td>` +
    `<td valign="top" style="padding:9px 0;border-top:1px solid ${LINE};font-size:14px;line-height:20px;color:${INK};font-weight:600;word-break:break-word;white-space:pre-wrap;">${esc(r.value)}</td></tr>`,
  ).join('');
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px 0;"><tr>` +
    `<td bgcolor="${RED}" style="background-color:${RED};border-radius:8px;">` +
    `<a href="${esc(url)}" style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>` +
    `</td></tr></table>`;
}

function codeBlock(label: string, text: string): string {
  return `<div style="font-size:12px;line-height:18px;font-weight:bold;letter-spacing:.5px;text-transform:uppercase;color:${MUTED};padding:4px 0 6px 0;">${esc(label)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;"><tr>` +
    `<td bgcolor="#1f1a1b" style="background-color:#1f1a1b;border-radius:8px;padding:14px 16px;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:19px;color:#f5eded;white-space:pre-wrap;word-break:break-all;">${esc(text)}</td>` +
    `</tr></table>`;
}

function dataTable(headers: string[], rows: string[][], footnote?: string): string {
  const th = headers.map((h) => `<th align="left" style="padding:7px 8px;font-size:12px;color:${MUTED};border-bottom:1px solid ${LINE};background-color:${PAPER};">${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td valign="top" style="padding:7px 8px;font-size:12px;line-height:17px;color:${INK};border-bottom:1px solid ${LINE};word-break:break-word;">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;border:1px solid ${LINE};border-radius:8px;"><tr>${th}</tr>${body}</table>` +
    (footnote ? `<p style="margin:0 0 18px 0;font-size:12px;line-height:18px;color:${MUTED};">${esc(footnote)}</p>` : '');
}

// ── the layout (same structure for every e-mail) ───────────────

interface Layout {
  preheader: string;
  chip: { label: string; tone: Tone };
  headline: string;
  greetingName?: string;
  /** Plain-text paragraphs, escaped here. */
  paragraphs: string[];
  callout?: { label: string; text: string; tone?: Tone };
  /** Adds "If you wish to reply ... quote your reference number X". */
  reference?: string;
  card?: { title: string; rows: Row[] };
  code?: { label: string; text: string };
  table?: { headers: string[]; rows: string[][]; footnote?: string };
  cta?: { label: string; path: string };
  subject: string;
}


// ── super-admin overrides (System Settings > Email) ────────────
// Text stored in the DB replaces the coded text of a template: subject, headline,
// body paragraphs and button label, with {{placeholders}} filled from the data the
// template was called with. Colours, layout, callouts and detail cards stay coded.

export interface TemplateOverride {
  subject?: string;
  headline?: string;
  paragraphs?: string[];
  ctaLabel?: string;
  /** false switches the e-mail off (ignored for NON_DISABLEABLE templates). */
  enabled?: boolean;
  /** Extra recipients copied on every send of this template. */
  cc?: string[];
}

/** Security-critical or credential-carrying e-mails: can be reworded but never switched off. */
export const NON_DISABLEABLE: ReadonlySet<string> = new Set(['emailChange', 'accountCreated', 'intakeInvite', 'partnerAccess', 'test']);

/** Data fields never offered as placeholders (secrets / one-time links). */
const SENSITIVE_FIELDS = new Set(['password', 'token', 'claimUrl', 'instructions']);

let overrideStore: Map<string, TemplateOverride> = new Map();
/** While set, this draft replaces the stored override for its key (used by the live preview). */
let previewDraft: { key: string; override: TemplateOverride | null } | null = null;
/** While true, overrides are ignored (used to read the coded defaults). */
let ignoreOverrides = false;
let current: { key: string; vars: Record<string, string> } | null = null;
let captureSink: { key: string; vars: Record<string, string>; layout?: Layout }[] | null = null;

export function setTemplateOverrides(map: Map<string, TemplateOverride>): void {
  overrideStore = map;
}

function overrideFor(key: string): TemplateOverride | null {
  if (ignoreOverrides) return null;
  if (previewDraft && previewDraft.key === key) return previewDraft.override;
  return overrideStore.get(key) ?? null;
}

/** Replaces {{name}} with the value (HTML-escaping happens later in render). Unknown names become empty. */
export function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
}

function varsOf(ctx: EmailContext, d: unknown): Record<string, string> {
  const out: Record<string, string> = { supportEmail: ctx.support, appBaseUrl: ctx.appBaseUrl };
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(k) || v === null || v === undefined) continue;
      if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    }
    const tid = (d as { transcriptId?: unknown }).transcriptId;
    if (typeof tid === 'string' && tid) out.ref = refOf(tid);
  }
  return out;
}

function applyOverride(l: Layout, o: TemplateOverride, vars: Record<string, string>): Layout {
  const f = (t: string) => fillPlaceholders(t, vars);
  const paragraphs = (o.paragraphs ?? []).map((p) => p.trim()).filter(Boolean);
  return {
    ...l,
    subject: o.subject?.trim() ? f(o.subject).replace(/[\r\n]+/g, ' ').trim() || l.subject : l.subject,
    headline: o.headline?.trim() ? f(o.headline) : l.headline,
    paragraphs: paragraphs.length ? paragraphs.map(f) : l.paragraphs,
    cta: l.cta && o.ctaLabel?.trim() ? { ...l.cta, label: f(o.ctaLabel) } : l.cta,
  };
}

function render(ctx: EmailContext, l: Layout): Email {
  if (captureSink && current) captureSink.push({ key: current.key, vars: current.vars, layout: l });
  if (current) {
    const o = overrideFor(current.key);
    if (o) l = applyOverride(l, o, current.vars);
  }
  const support = ctx.support;
  const mail = `<a href="mailto:${esc(support)}" style="color:${RED};font-weight:bold;">${esc(support)}</a>`;
  const ctaUrl = l.cta ? `${ctx.appBaseUrl}${l.cta.path}` : '';
  const chip = CHIP[l.chip.tone];
  const body =
    (l.greetingName !== undefined ? para(`Hello ${esc(first(l.greetingName))},`) : '') +
    l.paragraphs.map((p) => para(esc(p))).join('') +
    (l.callout ? callout(l.callout.label, l.callout.text, l.callout.tone ?? 'neutral') : '') +
    (l.code ? codeBlock(l.code.label, l.code.text) : '') +
    (l.table ? dataTable(l.table.headers, l.table.rows, l.table.footnote) : '') +
    (l.cta ? button(l.cta.label, ctaUrl) : '') +
    (l.reference
      ? para(`If you wish to reply, please write to us at ${mail} and quote your reference number <b>${esc(l.reference)}</b>.`, 'margin-bottom:20px;')
      : para(`If you have any questions, please write to us at ${mail}.`, 'margin-bottom:20px;'));

  const card = l.card && l.card.rows.length
    ? `<tr><td bgcolor="#ffffff" class="px" style="background-color:#ffffff;padding:8px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;border-left:1px solid ${LINE};border-right:1px solid ${LINE};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};border:1px solid ${LINE};border-radius:10px;">
        <tr><td style="padding:18px 20px 14px 20px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:24px;font-weight:bold;color:${RED_DARK};padding-bottom:6px;">${esc(l.card.title)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;">${rowsHtml(l.card.rows)}</table>
        </td></tr>
      </table>
    </td></tr>`
    : `<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:0 32px 16px 32px;border-left:1px solid ${LINE};border-right:1px solid ${LINE};font-size:0;line-height:0;">&nbsp;</td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(l.headline)}</title>
<style>
  :root{color-scheme:light;supported-color-schemes:light;}
  body{margin:0;padding:0;}
  @media only screen and (max-width:480px){
    .wrap{width:100% !important;}
    .px{padding-left:20px !important;padding-right:20px !important;}
    .h1{font-size:25px !important;line-height:32px !important;}
    .lbl{width:42% !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};" bgcolor="${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};font-size:1px;line-height:1px;">${esc(l.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td bgcolor="${RED}" style="background-color:${RED};border-radius:12px 12px 0 0;padding:22px 28px;" class="px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="width:216px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" valign="middle" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:14px;border:3px solid ${GOLD};padding:0;line-height:0;font-size:0;">
              <a href="${esc(ctx.appBaseUrl)}" style="text-decoration:none;"><img src="${ctx.appBaseUrl}/logo.png?v=3" width="210" height="110" alt="${BRAND_NAME}" style="display:block;width:210px;height:110px;border:0;outline:none;border-radius:11px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:110px;font-weight:bold;color:${RED};text-align:center;" /></a>
            </td>
          </tr></table>
        </td>
        <td valign="middle" align="right" style="padding-left:12px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:${ROSE};">${BRAND_TAGLINE}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${RED}" style="background-color:${RED};height:0;font-size:0;line-height:0;padding:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" bgcolor="${GOLD}" style="height:2px;font-size:0;line-height:0;background-color:${GOLD};">&nbsp;</td></tr><tr><td height="3" style="height:3px;font-size:0;line-height:0;background-color:${RED};">&nbsp;</td></tr><tr><td height="1" bgcolor="${ROSE}" style="height:1px;font-size:0;line-height:0;background-color:${ROSE};">&nbsp;</td></tr></table>
    </td></tr>
    <tr><td bgcolor="#ffffff" class="px" style="background-color:#ffffff;padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;border-left:1px solid ${LINE};border-right:1px solid ${LINE};">
      <span style="display:inline-block;padding:5px 14px;border-radius:999px;background-color:${chip.bg};color:${chip.fg};border:1px solid ${chip.border};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;">${esc(l.chip.label)}</span>
      <h1 class="h1" style="margin:16px 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;font-weight:bold;color:${RED_DARK};">${esc(l.headline)}</h1>
      ${body}
    </td></tr>
    ${card}
    <tr><td bgcolor="${RED_DARK}" class="px" style="background-color:${RED_DARK};border-radius:0 0 12px 12px;padding:22px 32px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:22px;font-weight:bold;color:#ffffff;">${BRAND_NAME}</div>
      <div style="font-size:12px;line-height:20px;color:${ROSE};">${BRAND_TAGLINE}</div>
      <div style="font-size:12px;line-height:20px;color:#f1dfe1;padding-top:8px;">Questions? Write to us at <a href="mailto:${esc(support)}" style="color:${GOLD};text-decoration:underline;">${esc(support)}</a> &middot; <a href="${esc(ctx.appBaseUrl)}" style="color:${GOLD};text-decoration:underline;">Open ${BRAND_NAME}</a></div>
      <div style="font-size:11px;line-height:18px;color:#d3b3b7;padding-top:8px;">This is an automated message. Please do not share this e-mail with anyone.</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text: string[] = [];
  if (l.greetingName !== undefined) text.push(`Hello ${first(l.greetingName)},`, '');
  text.push(...l.paragraphs.flatMap((p) => [p, '']));
  if (l.callout) text.push(`${l.callout.label ? `${l.callout.label}: ` : ''}${l.callout.text}`, '');
  if (l.code) text.push(l.code.label, l.code.text, '');
  if (l.table) text.push(l.table.headers.join(' | '), ...l.table.rows.map((r) => r.join(' | ')), l.table.footnote ?? '', '');
  if (l.cta) text.push(`${l.cta.label}: ${ctaUrl}`, '');
  text.push(l.reference
    ? `If you wish to reply, please write to us at ${support} and quote your reference number ${l.reference}.`
    : `If you have any questions, please write to us at ${support}.`);
  if (l.card?.rows.length) text.push('', l.card.title.toUpperCase(), ...l.card.rows.map((r) => `${r.label}: ${r.value}`));
  text.push('', '--', BRAND_NAME, BRAND_TAGLINE, 'This is an automated message.');

  return { subject: withRef(l.subject, l.reference), html, text: text.join('\n') };
}

// ── the catalogue ─────────────────────────────────────────────

const TRANSCRIPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending review', tone: 'neutral' },
  in_review: { label: 'Under review', tone: 'info' },
  processing: { label: 'Under review', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  needs_info: { label: 'Information needed', tone: 'warning' },
  complete: { label: 'Complete', tone: 'success' },
};

const baseTemplates = {
  /** Student registered themselves. */
  welcome(ctx: EmailContext, d: { firstName: string; email: string }): Email {
    return render(ctx, {
      subject: 'Welcome to TransferHub - your account is ready',
      preheader: 'Your TransferHub account is ready.',
      chip: { label: 'Account created', tone: 'success' },
      headline: 'Welcome to TransferHub',
      greetingName: d.firstName,
      paragraphs: [
        'Thank you for registering. Your account is ready and you can sign in at any time.',
        'Next, complete your profile, upload your transcript, and follow each course as it is evaluated.',
      ],
      cta: { label: 'Sign in to TransferHub', path: '/login' },
      card: { title: 'Your account', rows: [{ label: 'Sign-in email', value: d.email }] },
    });
  },

  /** Someone asked to change their sign-in email; sent to the NEW address. */
  emailChange(ctx: EmailContext, d: { firstName: string; newEmail: string; token: string }): Email {
    return render(ctx, {
      subject: 'Confirm your new TransferHub email address',
      preheader: 'Click the link to confirm your new sign-in email.',
      chip: { label: 'Confirm email', tone: 'info' },
      headline: 'Confirm your new email address',
      greetingName: d.firstName,
      paragraphs: [
        'We received a request to change the sign-in email on your TransferHub account to this address. Your email only changes after you confirm it with the button below. The link works for 24 hours.',
        'If you did not ask for this, ignore this message and your account stays as it is.',
      ],
      cta: { label: 'Confirm new email', path: `/verify-email?token=${encodeURIComponent(d.token)}` },
      card: { title: 'Requested change', rows: [{ label: 'New sign-in email', value: d.newEmail }] },
    });
  },

  /** A student asked (or a partner invited them) to import their record from their university. */
  intakeInvite(ctx: EmailContext, d: { firstName: string; institution: string; claimUrl: string }): Email {
    const url = d.claimUrl.startsWith(ctx.appBaseUrl) ? d.claimUrl.slice(ctx.appBaseUrl.length) : d.claimUrl;
    return render(ctx, {
      subject: 'Your transfer record is ready to review',
      preheader: 'Review your record and create your TransferHub account.',
      chip: { label: 'Review your record', tone: 'info' },
      headline: 'We found your student record',
      greetingName: d.firstName,
      paragraphs: [
        `We found your record from ${d.institution}. Review it, confirm it is correct, and choose a password to create your TransferHub account. Nothing is created until you confirm. The link works for 48 hours.`,
        'If you did not ask for this, ignore this message and no account will be made.',
      ],
      cta: { label: 'Review my record', path: url },
      card: { title: 'Your record', rows: [{ label: 'Institution', value: d.institution }] },
    });
  },

  /** An administrator created the account (temporary password). */
  accountCreated(ctx: EmailContext, d: { firstName: string; email: string; password: string; role?: string }): Email {
    return render(ctx, {
      subject: 'Your TransferHub account was created',
      preheader: 'Sign in with your temporary password and change it.',
      chip: { label: 'Account created', tone: 'info' },
      headline: 'An account was created for you',
      greetingName: d.firstName,
      paragraphs: ['An administrator created a TransferHub account for you. Sign in with the temporary password below and change it straight away.'],
      callout: { label: 'Temporary password', text: d.password, tone: 'warning' },
      cta: { label: 'Sign in', path: '/login' },
      card: {
        title: 'Your account',
        rows: [{ label: 'Sign-in email', value: d.email }, ...(d.role ? [{ label: 'Role', value: d.role.replace('_', ' ') }] : [])],
      },
    });
  },

  /** Staff changed a transcript's status. */
  transcriptStatus(ctx: EmailContext, d: { firstName: string; transcriptId: string; status: string; notes?: string }): Email {
    const s = TRANSCRIPT_STATUS[d.status] ?? { label: d.status, tone: 'neutral' as Tone };
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: `Your transfer credit evaluation is now "${s.label}"`,
      preheader: `Status update for request ${ref}.`,
      chip: { label: s.label, tone: s.tone },
      headline: 'An update on your evaluation',
      greetingName: d.firstName,
      paragraphs: ['There has been an update to your transfer credit evaluation.'],
      callout: d.notes ? { label: 'Note from the reviewer', text: d.notes, tone: s.tone === 'danger' ? 'danger' : 'neutral' } : undefined,
      cta: { label: 'View your evaluation', path: `/student/transcript/${d.transcriptId}` },
      reference: ref,
      card: { title: 'Regarding your request', rows: [{ label: 'Reference number', value: ref }, { label: 'Current status', value: s.label }] },
    });
  },

  /** A workflow stage is waiting for an approver. */
  approverAction(ctx: EmailContext, d: { name: string; student: string; stage: string; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: `Action needed: ${d.stage} - ${d.student}`,
      preheader: `${d.student}'s request is waiting for your decision.`,
      chip: { label: 'Action needed', tone: 'warning' },
      headline: 'A transfer request is waiting for you',
      greetingName: d.name,
      paragraphs: [`A transfer credit request is ready for your "${d.stage}" decision. The summary and AI suggestions are already prepared, so you can approve or reject it directly.`],
      cta: { label: 'Review request', path: `/requests/${d.transcriptId}` },
      reference: ref,
      card: { title: 'The request', rows: [{ label: 'Student', value: d.student }, { label: 'Stage', value: d.stage }, { label: 'Reference number', value: ref }] },
    });
  },

  /** The request was completed or rejected. */
  requestDecided(ctx: EmailContext, d: { firstName: string; transcriptId: string; rejected: boolean; stageName: string; reason?: string | null }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: d.rejected ? 'An update on your transfer credit request' : 'Your transfer credit request is complete',
      preheader: d.rejected ? `A decision was made on request ${ref}.` : `Your credit decisions for request ${ref} are posted.`,
      chip: d.rejected ? { label: 'Not approved', tone: 'danger' } : { label: 'Complete', tone: 'success' },
      headline: d.rejected ? 'An update on your request' : 'Your request is complete',
      greetingName: d.firstName,
      paragraphs: [d.rejected
        ? `After review, we are sorry to let you know that your transfer credit request was not approved at the "${d.stageName}" stage.`
        : 'Good news: your transfer credit request has been approved and your credit decisions are now posted.'],
      callout: d.reason ? { label: d.rejected ? 'Reason given' : 'A note from the reviewer', text: d.reason, tone: d.rejected ? 'danger' : 'success' } : undefined,
      cta: { label: 'View your request', path: `/student/transcript/${d.transcriptId}` },
      reference: ref,
      card: { title: 'Regarding your request', rows: [{ label: 'Reference number', value: ref }, { label: 'Current status', value: d.rejected ? 'Not approved' : 'Complete' }] },
    });
  },

  /** Sent to the sending (source) institution when a student's transfer evaluation completes. */
  sourceDecisionNotice(ctx: EmailContext, d: { contactName: string; studentName: string; sourceName: string; targetName: string; postedCredits: number; postedCourses: number; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: `Transfer evaluation complete - ${d.studentName}`,
      preheader: `${d.targetName} has completed the credit evaluation for a student from ${d.sourceName}.`,
      chip: { label: 'Evaluation complete', tone: 'success' },
      headline: 'A transfer evaluation has completed',
      greetingName: d.contactName,
      paragraphs: [
        `${d.targetName} has finished evaluating the transfer credits for ${d.studentName}, who studied at ${d.sourceName}.`,
        `${d.postedCourses} course(s) were posted, totalling ${d.postedCredits} transfer credit(s). This note is for your records as the sending institution.`,
      ],
      reference: ref,
      card: {
        title: 'Evaluation summary',
        rows: [
          { label: 'Student', value: d.studentName },
          { label: 'From', value: d.sourceName },
          { label: 'To', value: d.targetName },
          { label: 'Credits posted', value: String(d.postedCredits) },
          { label: 'Reference number', value: ref },
        ],
      },
    });
  },

  /** SLA watcher: a stage is past its due date. */
  stageOverdue(ctx: EmailContext, d: { name: string; student: string; stage: string; days: number; dueAt: Date | string; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: `Overdue: ${d.stage} - ${d.student}`,
      preheader: `About ${d.days} day(s) past due.`,
      chip: { label: 'Overdue', tone: 'danger' },
      headline: 'A transfer request is overdue',
      greetingName: d.name,
      paragraphs: [`The "${d.stage}" decision for ${d.student} is about ${d.days} day(s) past its due date. The summary is ready, so it only needs your approve or reject.`],
      cta: { label: 'Review request', path: `/requests/${d.transcriptId}` },
      reference: ref,
      card: { title: 'The request', rows: [
        { label: 'Student', value: d.student },
        { label: 'Stage', value: d.stage },
        { label: 'Was due', value: new Date(d.dueAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) },
        { label: 'Reference number', value: ref },
      ] },
    });
  },

  /** PRG-02: the credit-transfer deadline is close (90 / 30 / 7 days) and courses are still undecided. */
  deadlineApproaching(ctx: EmailContext, d: { name: string; audience: 'student' | 'staff'; student: string; deadlineOn: string; daysLeft: number; pendingCourses: number; months: number; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    const student = d.audience === 'student';
    const when = d.daysLeft <= 0 ? 'today' : `in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`;
    const n = `${d.pendingCourses} course${d.pendingCourses === 1 ? '' : 's'}`;
    return render(ctx, {
      subject: student ? `Transfer credit deadline ${when}` : `Credit deadline ${when}: ${d.student}`,
      preheader: `${n} still waiting on a decision.`,
      chip: { label: d.daysLeft <= 30 ? 'Deadline soon' : 'Deadline ahead', tone: d.daysLeft <= 30 ? 'danger' : 'warning' },
      headline: student ? 'Your transfer credit deadline is coming up' : 'A transfer credit deadline is coming up',
      greetingName: d.name,
      paragraphs: student
        ? [`Transfer credit must be transferred within ${d.months} months of starting. Your deadline is ${d.deadlineOn} (${when}) and ${n} still ${d.pendingCourses === 1 ? 'is' : 'are'} waiting on a decision. Please upload anything we have asked for, such as syllabi, so the reviewers can finish in time.`]
        : [`${d.student} must have all transfer credit decided within ${d.months} months of starting. The deadline is ${d.deadlineOn} (${when}) and ${n} still ${d.pendingCourses === 1 ? 'needs' : 'need'} a decision. Courses left undecided after the deadline go to review with a flag; none is denied for lateness.`],
      cta: student ? { label: 'View your request', path: `/student/transcript/${d.transcriptId}` } : { label: 'Open request', path: `/requests/${d.transcriptId}` },
      reference: ref,
      card: { title: 'The deadline', rows: [
        { label: 'Student', value: d.student },
        { label: 'Deadline', value: d.deadlineOn },
        { label: 'Courses still waiting', value: String(d.pendingCourses) },
        { label: 'Reference number', value: ref },
      ] },
    });
  },

  /** PRG-02: the deadline has passed and courses are still undecided. */
  deadlineOverdue(ctx: EmailContext, d: { name: string; audience: 'student' | 'staff'; student: string; deadlineOn: string; daysOver: number; pendingCourses: number; months: number; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    const student = d.audience === 'student';
    const n = `${d.pendingCourses} course${d.pendingCourses === 1 ? '' : 's'}`;
    return render(ctx, {
      subject: student ? 'Your transfer credit deadline has passed' : `Credit deadline passed: ${d.student}`,
      preheader: `${n} still waiting on a decision.`,
      chip: { label: 'Deadline passed', tone: 'danger' },
      headline: student ? 'Your transfer credit deadline has passed' : 'A transfer credit deadline has passed',
      greetingName: d.name,
      paragraphs: student
        ? [`The ${d.months}-month window to transfer credit ended on ${d.deadlineOn}, and ${n} still ${d.pendingCourses === 1 ? 'is' : 'are'} waiting on a decision. Nothing is denied automatically: a reviewer will look at each remaining course and decide whether it can still be accepted.`]
        : [`The ${d.months}-month window for ${d.student} ended on ${d.deadlineOn} (${d.daysOver} day${d.daysOver === 1 ? '' : 's'} ago) and ${n} still ${d.pendingCourses === 1 ? 'has' : 'have'} no decision. They are flagged "past deadline"; please decide whether to accept each one.`],
      cta: student ? { label: 'View your request', path: `/student/transcript/${d.transcriptId}` } : { label: 'Open request', path: `/requests/${d.transcriptId}` },
      reference: ref,
      card: { title: 'The deadline', rows: [
        { label: 'Student', value: d.student },
        { label: 'Deadline was', value: d.deadlineOn },
        { label: 'Courses still waiting', value: String(d.pendingCourses) },
        { label: 'Reference number', value: ref },
      ] },
    });
  },

  /** A student asked the reviewers for an update. */
  studentAskedForUpdate(ctx: EmailContext, d: { name: string; student: string; stage: string; waitingDays: number; message?: string | null; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: `Reminder: ${d.student} is waiting on "${d.stage}"`,
      preheader: `${d.student} asked for an update.`,
      chip: { label: 'Reminder', tone: 'info' },
      headline: 'A student is asking for an update',
      greetingName: d.name,
      paragraphs: [`${d.student} asked for an update on their transfer credit request.`],
      callout: d.message ? { label: 'Message from the student', text: d.message, tone: 'info' } : undefined,
      cta: { label: 'Open request', path: `/requests/${d.transcriptId}` },
      reference: ref,
      card: { title: 'The request', rows: [
        { label: 'Student', value: d.student },
        { label: 'Current stage', value: d.stage },
        { label: 'Waiting in this stage', value: `${d.waitingDays} day(s)` },
      ] },
    });
  },

  /** Reviewer sent the student a status update. */
  statusUpdate(ctx: EmailContext, d: { firstName: string; stage: string; message?: string | null; messageLabel?: string; transcriptId: string }): Email {
    const ref = refOf(d.transcriptId);
    return render(ctx, {
      subject: 'An update on your transfer credit request',
      preheader: `Your request is in "${d.stage}".`,
      chip: { label: 'In review', tone: 'info' },
      headline: 'A message about your request',
      greetingName: d.firstName,
      paragraphs: [`Here is the latest on your transfer credit request. It is currently in "${d.stage}".`],
      callout: d.message ? { label: d.messageLabel ?? 'Message from the reviewer', text: d.message, tone: 'neutral' } : undefined,
      cta: { label: 'View your request', path: `/student/transcript/${d.transcriptId}` },
      reference: ref,
      card: { title: 'Regarding your request', rows: [{ label: 'Reference number', value: ref }, { label: 'Current stage', value: d.stage }] },
    });
  },

  /** A new appeal for faculty / admins. */
  appealReceived(ctx: EmailContext, d: { name: string; code: string; title: string; student?: string; transcriptId?: string }): Email {
    const ref = d.transcriptId ? refOf(d.transcriptId) : undefined;
    return render(ctx, {
      subject: `Transfer credit appeal: ${d.code}`,
      preheader: `${d.code} needs to be re-evaluated.`,
      chip: { label: 'New appeal', tone: 'warning' },
      headline: 'A student appealed a decision',
      greetingName: d.name,
      paragraphs: [`A student asked for ${d.code} (${d.title}) to be re-evaluated. The reason, the proposed BU equivalent and the syllabus are attached to the appeal.`],
      cta: { label: 'Open appeals', path: '/appeals' },
      reference: ref,
      card: { title: 'The appeal', rows: [
        ...(d.student ? [{ label: 'Student', value: d.student }] : []),
        { label: 'Course', value: `${d.code} - ${d.title}` },
        ...(ref ? [{ label: 'Reference number', value: ref }] : []),
      ] },
    });
  },

  /** The department decided an appeal. */
  appealDecided(ctx: EmailContext, d: {
    firstName: string; code: string; outcome: string; label: string; department: string;
    satisfies?: string | null; denialReason?: string | null; comments?: string | null; transcriptId: string;
  }): Email {
    const ref = refOf(d.transcriptId);
    const denied = d.outcome === 'denied' || d.outcome === 'no_credit';
    const quote = d.denialReason || d.comments;
    return render(ctx, {
      subject: `Your appeal for ${d.code} has been decided`,
      preheader: `Your appeal for ${d.code} was ${d.label}.`,
      chip: denied ? { label: d.outcome === 'denied' ? 'Denied' : 'No credit', tone: 'danger' } : { label: 'Granted', tone: 'success' },
      headline: 'A decision on your appeal',
      greetingName: d.firstName,
      paragraphs: [`Thank you for your patience. Your appeal for ${d.code} was ${d.label}.`],
      callout: quote ? { label: d.denialReason ? 'Reason given' : 'Department comments', text: quote, tone: denied ? 'danger' : 'neutral' } : undefined,
      cta: { label: 'View your request', path: `/student/transcript/${d.transcriptId}` },
      reference: ref,
      card: { title: 'Regarding your appeal', rows: [
        { label: 'Course', value: d.code },
        { label: 'Decision', value: capitalise(d.label) },
        { label: 'Department', value: d.department },
        ...(d.satisfies ? [{ label: 'Satisfies', value: d.satisfies }] : []),
        { label: 'Reference number', value: ref },
      ] },
    });
  },

  /** Partner onboarding: endpoint + API key. */
  partnerAccess(ctx: EmailContext, d: { contactName: string; university: string; code: string; endpoint: string; instructions: string }): Email {
    return render(ctx, {
      subject: 'Your TransferHub data submission access',
      preheader: `Data submission access for ${d.university}.`,
      chip: { label: 'Access granted', tone: 'success' },
      headline: 'You can now send us your catalogue',
      greetingName: d.contactName,
      paragraphs: [
        `TransferHub has set up data submission access for ${d.university}. Use the details below to send universities, programs and courses to us, either through the partner portal or the API.`,
        'Everything you send is reviewed by an administrator before it is added.',
      ],
      code: { label: 'Instructions and API key (shown only in this e-mail - keep it secret)', text: d.instructions },
      cta: { label: 'Open the partner portal', path: '/partner' },
      card: { title: 'Your access', rows: [{ label: 'University', value: d.university }, { label: 'University code', value: d.code }, { label: 'Endpoint', value: d.endpoint }] },
    });
  },

  /** Partner: submission received. */
  submissionReceived(ctx: EmailContext, d: { contactName: string; reference: string; total: number; summary: string; checks: string }): Email {
    return render(ctx, {
      subject: 'We received your data submission',
      preheader: `Submission ${d.reference} is waiting for review.`,
      chip: { label: 'Received', tone: 'neutral' },
      headline: 'Thank you, we have received your data',
      greetingName: d.contactName,
      paragraphs: [
        `Your submission (${d.total} rows) has reached TransferHub safely and is waiting for review by an administrator.`,
        'Nothing is added until it is approved. We will e-mail you a report once it has been processed.',
      ],
      reference: d.reference,
      card: { title: 'Your submission', rows: [{ label: 'Reference number', value: d.reference }, { label: 'Contents', value: d.summary }, { label: 'Automatic checks', value: d.checks }] },
    });
  },

  /** Super admins: a submission is waiting. */
  submissionForReview(ctx: EmailContext, d: { firstName: string; reference: string; sender: string; total: number; summary: string; checks: string; note?: string | null }): Email {
    return render(ctx, {
      subject: `New data submission from ${d.sender}`,
      preheader: `${d.total} rows are waiting for review.`,
      chip: { label: 'New submission', tone: 'warning' },
      headline: 'A data submission is waiting for review',
      greetingName: d.firstName,
      paragraphs: [`${d.sender} sent ${d.total} rows for review.`],
      callout: d.note ? { label: 'Note from the sender', text: d.note, tone: 'neutral' } : undefined,
      cta: { label: 'Review submission', path: '/superadmin/settings/import' },
      reference: d.reference,
      card: { title: 'The submission', rows: [{ label: 'Reference number', value: d.reference }, { label: 'Contents', value: d.summary }, { label: 'Checks', value: d.checks }] },
    });
  },

  /** Partner: per-row report after review. */
  submissionReport(ctx: EmailContext, d: {
    contactName: string; reference: string; added: string; notImported: string; note?: string | null;
    rows: string[][]; footnote?: string;
  }): Email {
    return render(ctx, {
      subject: `Report for your data submission ${d.reference}`,
      preheader: `${d.added}.`,
      chip: { label: 'Processed', tone: 'success' },
      headline: 'Your submission has been reviewed',
      greetingName: d.contactName,
      paragraphs: ['Your data submission has been reviewed. Here is what happened to each item.'],
      callout: d.note ? { label: 'A message from the reviewer', text: d.note, tone: 'neutral' } : undefined,
      table: { headers: ['#', 'Type', 'Item', 'Result', 'Details'], rows: d.rows, footnote: d.footnote },
      reference: d.reference,
      card: { title: 'Your submission', rows: [{ label: 'Reference number', value: d.reference }, { label: 'Added / updated', value: d.added }, { label: 'Not imported', value: d.notImported }] },
    });
  },

  /** One side of a transfer asked another for a document. `path` differs for the student and for staff. */
  documentRequested(ctx: EmailContext, d: { name: string; fromName: string; student: string; title: string; message?: string | null; dueDate?: string | null; path: string; transcriptId: string; source: string; target: string }): Email {
    return render(ctx, {
      subject: `Document requested: ${d.title}`,
      preheader: `${d.fromName} asked for "${d.title}".`,
      chip: { label: 'Document requested', tone: 'warning' },
      headline: 'A document is needed for a transfer request',
      greetingName: d.name,
      paragraphs: [`${d.fromName} asked for a document on the transfer credit request for ${d.student}.`],
      callout: d.message ? { label: `Message from ${d.fromName}`, text: d.message, tone: 'warning' } : undefined,
      cta: { label: 'Open the request and respond', path: d.path },
      reference: refOf(d.transcriptId),
      card: { title: 'What is needed', rows: [
        { label: 'Document', value: d.title },
        { label: 'Asked by', value: d.fromName },
        { label: 'Student', value: d.student },
        { label: 'Transfer', value: `${d.source} to ${d.target}` },
        ...(d.dueDate ? [{ label: 'Please send by', value: d.dueDate }] : []),
      ] },
    });
  },

  /** A requested document arrived (or was declined / cancelled). */
  documentResolved(ctx: EmailContext, d: { name: string; byName: string; student: string; title: string; outcome: 'fulfilled' | 'declined' | 'cancelled'; note?: string | null; path: string; transcriptId: string }): Email {
    const verb = { fulfilled: 'sent', declined: 'declined to send', cancelled: 'withdrew the request for' }[d.outcome];
    return render(ctx, {
      subject: `Document ${d.outcome}: ${d.title}`,
      preheader: `${d.byName} ${verb} "${d.title}".`,
      chip: { label: d.outcome === 'fulfilled' ? 'Document received' : d.outcome === 'declined' ? 'Request declined' : 'Request withdrawn', tone: d.outcome === 'fulfilled' ? 'success' : 'neutral' },
      headline: d.outcome === 'fulfilled' ? 'A requested document has arrived' : 'A document request was closed',
      greetingName: d.name,
      paragraphs: [`${d.byName} ${verb} "${d.title}" on the transfer credit request for ${d.student}.`],
      callout: d.note ? { label: 'Note', text: d.note, tone: 'neutral' } : undefined,
      cta: { label: 'Open the request', path: d.path },
      reference: refOf(d.transcriptId),
    });
  },

  /** Party-to-party reminder (student, sending university, receiving university). */
  partyReminder(ctx: EmailContext, d: { name: string; fromName: string; student: string; subjectLine: string; message?: string | null; path: string; transcriptId: string; source: string; target: string }): Email {
    return render(ctx, {
      subject: `Reminder from ${d.fromName}: ${d.subjectLine}`,
      preheader: `${d.fromName} sent a reminder about a transfer request.`,
      chip: { label: 'Reminder', tone: 'info' },
      headline: 'A reminder about a transfer request',
      greetingName: d.name,
      paragraphs: [`${d.fromName} sent you a reminder about the transfer credit request for ${d.student}: ${d.subjectLine}.`],
      callout: d.message ? { label: `Message from ${d.fromName}`, text: d.message, tone: 'info' } : undefined,
      cta: { label: 'Open the request', path: d.path },
      reference: refOf(d.transcriptId),
      card: { title: 'The transfer', rows: [
        { label: 'Student', value: d.student },
        { label: 'From', value: d.source },
        { label: 'To', value: d.target },
      ] },
    });
  },

  /** System Settings > Email > Send test. */
  test(ctx: EmailContext, d: { from: string }): Email {
    return render(ctx, {
      subject: 'TransferHub test e-mail',
      preheader: 'E-mail delivery works.',
      chip: { label: 'Test', tone: 'info' },
      headline: 'E-mail delivery works',
      paragraphs: ['If you can read this, TransferHub can send e-mail through Resend.'],
      card: { title: 'Delivery details', rows: [{ label: 'Sent from', value: d.from }, { label: 'Sent at', value: new Date().toUTCString() }] },
    });
  },
};

type Templates = typeof baseTemplates;

/**
 * The public catalogue: each coded template, wrapped so the stored override (if any)
 * is applied inside `render` and the result carries its key, cc list and on/off state.
 */
export const templates: Templates = Object.fromEntries(
  Object.entries(baseTemplates).map(([key, fn]) => [
    key,
    (ctx: EmailContext, d: unknown): Email => {
      const prev = current;
      current = { key, vars: varsOf(ctx, d) };
      try {
        const email = (fn as (c: EmailContext, x: unknown) => Email)(ctx, d);
        const o = overrideFor(key);
        return {
          ...email,
          key,
          ...(o?.cc?.length ? { cc: o.cc } : {}),
          ...(o && o.enabled === false && !NON_DISABLEABLE.has(key) ? { suppressed: true } : {}),
        };
      } finally {
        current = prev;
      }
    },
  ]),
) as unknown as Templates;

export type TemplateKey = keyof typeof baseTemplates;

/** Sample data for every template, for the preview gallery. */
export function samples(ctx: EmailContext, from: string): { key: TemplateKey; name: string; audience: string; email: Email }[] {
  const tid = '1f306ab4-5c2d-4e8a-9b1c-2d3e4f506172';
  return [
    { key: 'welcome', name: 'Welcome (self-registration)', audience: 'Student', email: templates.welcome(ctx, { firstName: 'Priya', email: 'priya@example.com' }) },
    { key: 'emailChange', name: 'Confirm a new email address', audience: 'Any user', email: templates.emailChange(ctx, { firstName: 'Priya', newEmail: 'priya.new@example.com', token: 'sample-token' }) },
    { key: 'intakeInvite', name: 'Student record found (import link)', audience: 'Student', email: templates.intakeInvite(ctx, { firstName: 'Priya', institution: 'Northeastern University', claimUrl: `${ctx.appBaseUrl}/intake/claim?token=sample-token` }) },
    { key: 'accountCreated', name: 'Account created by an admin', audience: 'Any user', email: templates.accountCreated(ctx, { firstName: 'Priya', email: 'priya@example.com', password: 'Temp#4821', role: 'faculty' }) },
    { key: 'transcriptStatus', name: 'Evaluation status changed', audience: 'Student', email: templates.transcriptStatus(ctx, { firstName: 'Priya', transcriptId: tid, status: 'needs_info', notes: 'Please upload the syllabus for MATH 210.' }) },
    { key: 'approverAction', name: 'Stage waiting for an approver', audience: 'Approvers', email: templates.approverAction(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', transcriptId: tid }) },
    { key: 'requestDecided', name: 'Request completed', audience: 'Student', email: templates.requestDecided(ctx, { firstName: 'Priya', transcriptId: tid, rejected: false, stageName: 'Final approval', reason: null }) },
    { key: 'requestDecided', name: 'Request not approved', audience: 'Student', email: templates.requestDecided(ctx, { firstName: 'Priya', transcriptId: tid, rejected: true, stageName: 'Faculty review', reason: 'The official transcript is missing the fall term.' }) },
    { key: 'stageOverdue', name: 'Stage overdue', audience: 'Approvers + admins', email: templates.stageOverdue(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', days: 3, dueAt: new Date(Date.now() - 3 * 86_400_000), transcriptId: tid }) },
    { key: 'deadlineApproaching', name: 'Credit deadline approaching (90/30/7 days)', audience: 'Student + approvers', email: templates.deadlineApproaching(ctx, { name: 'Priya', audience: 'student', student: 'Priya Rao', deadlineOn: '2027-01-15', daysLeft: 30, pendingCourses: 3, months: 12, transcriptId: tid }) },
    { key: 'deadlineOverdue', name: 'Credit deadline passed', audience: 'Student + approvers', email: templates.deadlineOverdue(ctx, { name: 'Alex Chen', audience: 'staff', student: 'Priya Rao', deadlineOn: '2026-09-01', daysOver: 4, pendingCourses: 2, months: 12, transcriptId: tid }) },
    { key: 'studentAskedForUpdate', name: 'Student asked for an update', audience: 'Approvers', email: templates.studentAskedForUpdate(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', waitingDays: 5, message: 'I need to register for spring classes soon.', transcriptId: tid }) },
    { key: 'statusUpdate', name: 'Status update from a reviewer', audience: 'Student', email: templates.statusUpdate(ctx, { firstName: 'Priya', stage: 'Faculty review', message: 'We will get back to you shortly.', transcriptId: tid }) },
    { key: 'appealReceived', name: 'New appeal', audience: 'Faculty + admins', email: templates.appealReceived(ctx, { name: 'Alex Chen', code: 'CS 2000', title: 'Discrete Structures', transcriptId: tid }) },
    { key: 'appealDecided', name: 'Appeal decided', audience: 'Student', email: templates.appealDecided(ctx, { firstName: 'Priya', code: 'CS 2000', outcome: 'equivalent', label: 'granted a BU equivalent', department: 'Computer Science', satisfies: 'CS major core (not Hub)', comments: 'The syllabus covers CAS CS 131 in full.', transcriptId: tid }) },
    { key: 'partnerAccess', name: 'Partner access + API key', audience: 'Partner contact', email: templates.partnerAccess(ctx, { contactName: 'Jordan Lee', university: 'Northeastern University', code: 'NEU', endpoint: `${ctx.appBaseUrl}/api/public/v1/submissions`, instructions: 'API key     : th_live_XXXXXXXXXXXXXXXX\nSubmit data : POST /api/public/v1/submissions (header X-API-Key)' }) },
    { key: 'submissionReceived', name: 'Submission received', audience: 'Partner contact', email: templates.submissionReceived(ctx, { contactName: 'Jordan Lee', reference: 'IMP-000012', total: 42, summary: '1 universities, 3 programs, 38 courses', checks: '40 clean, 2 with warnings, 0 with errors' }) },
    { key: 'submissionForReview', name: 'Submission waiting for review', audience: 'Super admins', email: templates.submissionForReview(ctx, { firstName: 'Sam', reference: 'IMP-000012', sender: 'Northeastern University (Jordan Lee)', total: 42, summary: '1 universities, 3 programs, 38 courses', checks: '40 clean, 2 warnings, 0 errors' }) },
    { key: 'submissionReport', name: 'Submission report', audience: 'Partner contact', email: templates.submissionReport(ctx, { contactName: 'Jordan Lee', reference: 'IMP-000012', added: '38 added, 2 updated', notImported: '2 not accepted, 0 failed, 0 still waiting', note: 'Two courses were missing credit values.', rows: [['1', 'University', 'NEU - Northeastern University', 'Updated', ''], ['2', 'Course', 'CS 2000 Discrete Structures', 'Added', ''], ['3', 'Course', 'CS 9999 Draft', 'Not accepted', 'Missing credits']] }) },
    { key: 'documentRequested', name: 'Document requested (transfer exchange)', audience: 'Student or university staff', email: templates.documentRequested(ctx, { name: 'Priya', fromName: 'Northeastern University', student: 'Priya Rao', title: 'Official transcript (final term)', message: 'Please send the Spring 2026 grades once posted.', dueDate: '2026-12-01', path: `/student/transcript/${tid}`, transcriptId: tid, source: 'Northeastern University', target: 'Boston University' }) },
    { key: 'documentResolved', name: 'Document request answered', audience: 'The requesting side', email: templates.documentResolved(ctx, { name: 'Alex Chen', byName: 'Northeastern University', student: 'Priya Rao', title: 'Official transcript (final term)', outcome: 'fulfilled', path: `/transfers/${tid}`, transcriptId: tid }) },
    { key: 'partyReminder', name: 'Reminder between parties', audience: 'Student or university staff', email: templates.partyReminder(ctx, { name: 'Alex Chen', fromName: 'Priya Rao (student)', student: 'Priya Rao', subjectLine: 'still waiting on the official transcript', message: 'Registration opens next week.', path: `/transfers/${tid}`, transcriptId: tid, source: 'Northeastern University', target: 'Boston University' }) },
    { key: 'test', name: 'Test e-mail', audience: 'Super admin', email: templates.test(ctx, { from }) },
  ];
}

/** Coded text + available placeholders for one template (rendered with sample data, no overrides). */
export interface TemplateDefaults {
  subject: string;
  headline: string;
  paragraphs: string[];
  ctaLabel: string;
  hasCta: boolean;
  placeholders: string[];
}

/** One entry per template key (first sample wins): name, audience, defaults and placeholders. */
export function templateCatalogue(ctx: EmailContext, from: string): { key: TemplateKey; name: string; audience: string; canDisable: boolean; defaults: TemplateDefaults }[] {
  const sink: NonNullable<typeof captureSink> = [];
  captureSink = sink;
  ignoreOverrides = true;
  let list: ReturnType<typeof samples>;
  try {
    list = samples(ctx, from);
  } finally {
    captureSink = null;
    ignoreOverrides = false;
  }
  const seen = new Set<string>();
  const out: ReturnType<typeof templateCatalogue> = [];
  list.forEach((s, i) => {
    if (seen.has(s.key)) return;
    seen.add(s.key);
    const c = sink[i];
    const l = c?.layout;
    out.push({
      key: s.key,
      name: s.name,
      audience: s.audience,
      canDisable: !NON_DISABLEABLE.has(s.key),
      defaults: {
        subject: l?.subject ?? s.email.subject,
        headline: l?.headline ?? '',
        paragraphs: l?.paragraphs ?? [],
        ctaLabel: l?.cta?.label ?? '',
        hasCta: !!l?.cta,
        placeholders: Object.keys(c?.vars ?? {}),
      },
    });
  });
  return out;
}

/** Renders a template's sample with a draft override (or none) instead of the stored one. */
export function previewWithDraft(ctx: EmailContext, from: string, key: string, draft: TemplateOverride | null): Email | null {
  previewDraft = { key, override: draft };
  try {
    const hit = samples(ctx, from).find((s) => s.key === key);
    return hit ? { ...hit.email, suppressed: undefined } : null;
  } finally {
    previewDraft = null;
  }
}

/** Trims, bounds and validates an override coming from the API. Throws Error(message) on bad input. */
export function sanitizeOverride(key: string, raw: TemplateOverride): TemplateOverride {
  const out: TemplateOverride = {};
  const str = (v: unknown, max: number, label: string) => {
    const t = String(v ?? '').trim();
    if (t.length > max) throw new Error(`${label} is too long (max ${max} characters).`);
    return t;
  };
  const subject = str(raw.subject, 200, 'Subject');
  if (subject) out.subject = subject;
  const headline = str(raw.headline, 200, 'Headline');
  if (headline) out.headline = headline;
  const ctaLabel = str(raw.ctaLabel, 60, 'Button label');
  if (ctaLabel) out.ctaLabel = ctaLabel;
  const paragraphs = (raw.paragraphs ?? []).map((p) => str(p, 1200, 'A paragraph')).filter(Boolean);
  if (paragraphs.length > 8) throw new Error('At most 8 paragraphs.');
  if (paragraphs.length) out.paragraphs = paragraphs;
  const cc = [...new Set((raw.cc ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (cc.length > 10) throw new Error('At most 10 CC addresses.');
  for (const e of cc) if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) || e.length > 254) throw new Error(`"${e}" is not a valid e-mail address.`);
  if (cc.length) out.cc = cc;
  // Switching off is only recorded for e-mails that may be switched off.
  if (raw.enabled === false && !NON_DISABLEABLE.has(key)) out.enabled = false;
  return out;
}
