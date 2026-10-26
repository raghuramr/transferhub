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

function render(ctx: EmailContext, l: Layout): Email {
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
        <td width="64" valign="middle" style="width:64px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="58" height="58" align="center" valign="middle" bgcolor="#ffffff" style="width:58px;height:58px;line-height:58px;border-radius:32px;background-color:#ffffff;border:3px solid ${GOLD};">
              <img src="${ctx.appBaseUrl}/logo-icon.png" width="44" height="44" alt="${BRAND_NAME}" style="display:block;width:44px;height:44px;border:0;outline:none;" />
            </td>
          </tr></table>
        </td>
        <td valign="middle" style="padding-left:16px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;">${BRAND_NAME}</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:${ROSE};padding-top:2px;">${BRAND_TAGLINE}</div>
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

export const templates = {
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

export type TemplateKey = keyof typeof templates;

/** Sample data for every template, for the preview gallery. */
export function samples(ctx: EmailContext, from: string): { key: TemplateKey; name: string; audience: string; email: Email }[] {
  const tid = '1f306ab4-5c2d-4e8a-9b1c-2d3e4f506172';
  return [
    { key: 'welcome', name: 'Welcome (self-registration)', audience: 'Student', email: templates.welcome(ctx, { firstName: 'Priya', email: 'priya@example.com' }) },
    { key: 'accountCreated', name: 'Account created by an admin', audience: 'Any user', email: templates.accountCreated(ctx, { firstName: 'Priya', email: 'priya@example.com', password: 'Temp#4821', role: 'faculty' }) },
    { key: 'transcriptStatus', name: 'Evaluation status changed', audience: 'Student', email: templates.transcriptStatus(ctx, { firstName: 'Priya', transcriptId: tid, status: 'needs_info', notes: 'Please upload the syllabus for MATH 210.' }) },
    { key: 'approverAction', name: 'Stage waiting for an approver', audience: 'Approvers', email: templates.approverAction(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', transcriptId: tid }) },
    { key: 'requestDecided', name: 'Request completed', audience: 'Student', email: templates.requestDecided(ctx, { firstName: 'Priya', transcriptId: tid, rejected: false, stageName: 'Final approval', reason: null }) },
    { key: 'requestDecided', name: 'Request not approved', audience: 'Student', email: templates.requestDecided(ctx, { firstName: 'Priya', transcriptId: tid, rejected: true, stageName: 'Faculty review', reason: 'The official transcript is missing the fall term.' }) },
    { key: 'stageOverdue', name: 'Stage overdue', audience: 'Approvers + admins', email: templates.stageOverdue(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', days: 3, dueAt: new Date(Date.now() - 3 * 86_400_000), transcriptId: tid }) },
    { key: 'studentAskedForUpdate', name: 'Student asked for an update', audience: 'Approvers', email: templates.studentAskedForUpdate(ctx, { name: 'Alex Chen', student: 'Priya Rao', stage: 'Faculty review', waitingDays: 5, message: 'I need to register for spring classes soon.', transcriptId: tid }) },
    { key: 'statusUpdate', name: 'Status update from a reviewer', audience: 'Student', email: templates.statusUpdate(ctx, { firstName: 'Priya', stage: 'Faculty review', message: 'We will get back to you shortly.', transcriptId: tid }) },
    { key: 'appealReceived', name: 'New appeal', audience: 'Faculty + admins', email: templates.appealReceived(ctx, { name: 'Alex Chen', code: 'CS 2000', title: 'Discrete Structures', transcriptId: tid }) },
    { key: 'appealDecided', name: 'Appeal decided', audience: 'Student', email: templates.appealDecided(ctx, { firstName: 'Priya', code: 'CS 2000', outcome: 'equivalent', label: 'granted a BU equivalent', department: 'Computer Science', satisfies: 'CS major core (not Hub)', comments: 'The syllabus covers CAS CS 131 in full.', transcriptId: tid }) },
    { key: 'partnerAccess', name: 'Partner access + API key', audience: 'Partner contact', email: templates.partnerAccess(ctx, { contactName: 'Jordan Lee', university: 'Northeastern University', code: 'NEU', endpoint: `${ctx.appBaseUrl}/api/public/v1/submissions`, instructions: 'API key     : th_live_XXXXXXXXXXXXXXXX\nSubmit data : POST /api/public/v1/submissions (header X-API-Key)' }) },
    { key: 'submissionReceived', name: 'Submission received', audience: 'Partner contact', email: templates.submissionReceived(ctx, { contactName: 'Jordan Lee', reference: 'IMP-000012', total: 42, summary: '1 universities, 3 programs, 38 courses', checks: '40 clean, 2 with warnings, 0 with errors' }) },
    { key: 'submissionForReview', name: 'Submission waiting for review', audience: 'Super admins', email: templates.submissionForReview(ctx, { firstName: 'Sam', reference: 'IMP-000012', sender: 'Northeastern University (Jordan Lee)', total: 42, summary: '1 universities, 3 programs, 38 courses', checks: '40 clean, 2 warnings, 0 errors' }) },
    { key: 'submissionReport', name: 'Submission report', audience: 'Partner contact', email: templates.submissionReport(ctx, { contactName: 'Jordan Lee', reference: 'IMP-000012', added: '38 added, 2 updated', notImported: '2 not accepted, 0 failed, 0 still waiting', note: 'Two courses were missing credit values.', rows: [['1', 'University', 'NEU - Northeastern University', 'Updated', ''], ['2', 'Course', 'CS 2000 Discrete Structures', 'Added', ''], ['3', 'Course', 'CS 9999 Draft', 'Not accepted', 'Missing credits']] }) },
    { key: 'test', name: 'Test e-mail', audience: 'Super admin', email: templates.test(ctx, { from }) },
  ];
}
