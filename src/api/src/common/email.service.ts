import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;
  private readonly fromName: string;
  private readonly appBaseUrl: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromAddress = process.env.RESEND_FROM_EMAIL || 'support@wcubeprojects.in';
    this.fromName = process.env.RESEND_FROM_NAME || 'TransferHub';
    this.appBaseUrl = process.env.APP_BASE_URL || 'https://transferhub.azurewebsites.net';
  }

  private get fromHeader(): string {
    return `${this.fromName} <${this.fromAddress}>`;
  }

  private wrapHtml(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5fa3 100%); padding: 32px 40px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; font-weight: 700; margin: 16px 0 4px; }
    .header p { color: rgba(255,255,255,0.8); font-size: 14px; margin: 0; }
    .body { padding: 40px; }
    .body h2 { color: #1e3a5f; font-size: 20px; font-weight: 600; margin: 0 0 16px; }
    .body p { color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .info-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .info-card .label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .info-card .value { font-size: 15px; color: #111827; font-weight: 500; }
    .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-approved { background: #d1fae5; color: #065f46; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-inreview { background: #dbeafe; color: #1e40af; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #1e3a5f 0%, #2d5fa3 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .footer { background: #f8fafc; padding: 24px 40px; text-align: center; }
    .footer p { color: #9ca3af; font-size: 12px; margin: 4px 0; }
    .footer a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="display:inline-flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:48px;height:48px;background:rgba(255,255,255,0.2);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
        </div>
      </div>
      <h1>TransferHub</h1>
      <p>Credit Evaluation Platform</p>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} TransferHub. All rights reserved.</p>
      <p><a href="${this.appBaseUrl}">Visit TransferHub</a> &middot; <a href="mailto:support@wcubeprojects.in">Contact Support</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  buildWelcomeEmail(firstName: string, email: string): { subject: string; html: string } {
    const loginUrl = `${this.appBaseUrl}/login`;
    const content = `
      <h2>Welcome to TransferHub, ${firstName}!</h2>
      <p>Your account has been created successfully. You can now log in and start your transfer credit evaluation journey.</p>
      <div class="info-card">
        <div class="label">Your Login Email</div>
        <div class="value">${email}</div>
      </div>
      <p>Here&#39;s what you can do next:</p>
      <ul style="color:#4b5563;font-size:15px;line-height:1.8;padding-left:20px;">
        <li>Complete your student profile</li>
        <li>Upload your transcript for evaluation</li>
        <li>Track the status of your credit evaluations</li>
      </ul>
      <p style="text-align:center;margin-top:32px;">
        <a href="${loginUrl}" class="cta-button">Log In to TransferHub</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px;color:#6b7280;">If you did not create this account, please contact us at <a href="mailto:support@wcubeprojects.in" style="color:#2d5fa3;">support@wcubeprojects.in</a> immediately.</p>
    `;
    return {
      subject: 'Welcome to TransferHub — Your Account is Ready',
      html: this.wrapHtml('Welcome to TransferHub', content),
    };
  }

  buildTranscriptStatusEmail(
    firstName: string,
    transcriptId: string,
    status: string,
    notes?: string,
  ): { subject: string; html: string } {
    const statusLabels: Record<string, string> = {
      pending: 'Pending Review',
      in_review: 'Under Review',
      processing: 'Under Review',
      approved: 'Approved',
      rejected: 'Rejected',
      needs_info: 'Additional Information Required',
    };
    const statusClasses: Record<string, string> = {
      pending: 'status-pending',
      in_review: 'status-inreview',
      processing: 'status-inreview',
      approved: 'status-approved',
      rejected: 'status-rejected',
      needs_info: 'status-pending',
    };
    const label = statusLabels[status] ?? status;
    const badgeClass = statusClasses[status] ?? 'status-pending';
    const deepLink = `${this.appBaseUrl}/student/transcript/${transcriptId}`;

    const notesHtml = notes
      ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" /><div class="label">Faculty Notes</div><div class="value" style="font-size:14px;">${notes}</div>`
      : '';

    const content = `
      <h2>Transcript Evaluation Update</h2>
      <p>Hi ${firstName}, there has been an update to your transcript evaluation request.</p>
      <div class="info-card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="label">Evaluation ID</div>
            <div class="value">${transcriptId}</div>
          </div>
          <div>
            <div class="label">New Status</div>
            <div class="value"><span class="status-badge ${badgeClass}">${label}</span></div>
          </div>
        </div>
        ${notesHtml}
      </div>
      <p style="text-align:center;margin-top:32px;">
        <a href="${deepLink}" class="cta-button">View Evaluation Details</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px;color:#6b7280;">Questions? Contact us at <a href="mailto:support@wcubeprojects.in" style="color:#2d5fa3;">support@wcubeprojects.in</a></p>
    `;
    return {
      subject: `TransferHub: Your Evaluation is now "${label}"`,
      html: this.wrapHtml('Evaluation Status Update', content),
    };
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  get baseUrl(): string {
    return this.appBaseUrl;
  }

  private esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * One generic, HTML-escaped template for every workflow email (stage
   * assigned, nudge, status update, decision). Callers pass plain text.
   */
  async sendWorkflowNotice(opts: {
    to: string;
    subject: string;
    heading: string;
    greetingName: string;
    intro: string;
    details?: { label: string; value: string }[];
    quote?: { label: string; text: string };
    ctaLabel: string;
    ctaPath: string;
  }): Promise<void> {
    const details = (opts.details ?? [])
      .map((d) => `<div style="margin-bottom:10px;"><div class="label">${this.esc(d.label)}</div><div class="value">${this.esc(d.value)}</div></div>`)
      .join('');
    const quote = opts.quote
      ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" /><div class="label">${this.esc(opts.quote.label)}</div><div class="value" style="font-size:14px;white-space:pre-wrap;">${this.esc(opts.quote.text)}</div>`
      : '';
    const content = `
      <h2>${this.esc(opts.heading)}</h2>
      <p>Hi ${this.esc(opts.greetingName)}, ${this.esc(opts.intro)}</p>
      ${details || quote ? `<div class="info-card">${details}${quote}</div>` : ''}
      <p style="text-align:center;margin-top:32px;">
        <a href="${this.appBaseUrl}${opts.ctaPath}" class="cta-button">${this.esc(opts.ctaLabel)}</a>
      </p>`;
    await this.send(opts.to, opts.subject, this.wrapHtml(opts.heading, content));
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`RESEND_API_KEY not set — skipping email to ${to}: "${subject}"`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.fromHeader,
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  async sendWelcome(to: string, firstName: string): Promise<void> {
    const { subject, html } = this.buildWelcomeEmail(firstName, to);
    await this.send(to, subject, html);
  }

  async sendTranscriptStatus(
    to: string,
    firstName: string,
    transcriptId: string,
    status: string,
    notes?: string,
  ): Promise<void> {
    const { subject, html } = this.buildTranscriptStatusEmail(firstName, transcriptId, status, notes);
    await this.send(to, subject, html);
  }
}
