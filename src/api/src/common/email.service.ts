import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { samples, templates, type Email, type EmailContext } from './email-templates';

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface EmailAttempt extends EmailResult {
  to: string;
  subject: string;
  at: string;
}

@Injectable()
export class EmailService {
  /** Last send attempts, shared by every instance (each module gets its own EmailService). */
  private static recent: EmailAttempt[] = [];

  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;
  private readonly fromName: string;
  private readonly appBaseUrl: string;
  private readonly supportEmail: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromAddress = process.env.RESEND_FROM_EMAIL || 'support@wcubeprojects.in';
    this.fromName = process.env.RESEND_FROM_NAME || 'TransferHub';
    this.appBaseUrl = (process.env.APP_BASE_URL || 'https://transferhub.azurewebsites.net').replace(/\/+$/, '');
    this.supportEmail = process.env.SUPPORT_EMAIL || this.fromAddress;
  }

  private get fromHeader(): string {
    return `${this.fromName} <${this.fromAddress}>`;
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  get baseUrl(): string {
    return this.appBaseUrl;
  }

  /** What every template needs: links point here, replies go to the support address. */
  get context(): EmailContext {
    return { appBaseUrl: this.appBaseUrl, support: this.supportEmail };
  }

  /** Sends one rendered template (see email-templates.ts). */
  sendEmail(to: string, email: Email): Promise<EmailResult> {
    return this.send(to, email.subject, email.html, email.text);
  }

  /**
   * Resend's SDK does not throw when it rejects a message (unverified sender
   * domain, a test key sending to someone other than the account owner, bad
   * address...): it returns `{ error }`. Check it, or failures vanish silently.
   */
  async send(to: string, subject: string, html: string, text?: string): Promise<EmailResult> {
    if (!this.resend) {
      this.logger.warn(`RESEND_API_KEY not set — skipping email to ${to}: "${subject}"`);
      return this.remember(to, subject, { ok: false, error: 'RESEND_API_KEY is not set on the server.' });
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromHeader,
        to,
        subject,
        html,
        ...(text ? { text } : {}),
      });
      if (error) {
        this.logger.error(`Resend rejected email to ${to} ("${subject}") from ${this.fromAddress}: ${error.name}: ${error.message}`);
        return this.remember(to, subject, { ok: false, error: `${error.message} (${error.name})` });
      }
      return this.remember(to, subject, { ok: true, id: data?.id });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
      return this.remember(to, subject, { ok: false, error: (err as Error).message });
    }
  }

  private remember(to: string, subject: string, result: EmailResult): EmailResult {
    EmailService.recent.unshift({ ...result, to, subject, at: new Date().toISOString() });
    EmailService.recent.length = Math.min(EmailService.recent.length, 20);
    return result;
  }

  /** Configuration and the most recent attempts (since the API last started), for the settings page. */
  status() {
    return {
      configured: this.isConfigured,
      fromAddress: this.fromAddress,
      fromName: this.fromName,
      fromDomain: this.fromAddress.split('@')[1] ?? '',
      fromIsDefault: !process.env.RESEND_FROM_EMAIL,
      supportEmail: this.supportEmail,
      appBaseUrl: this.appBaseUrl,
      recent: EmailService.recent,
    };
  }

  /** Every template rendered with sample data, for the preview gallery. */
  samples() {
    return samples(this.context, this.fromHeader).map((s, i) => ({ id: i, key: s.key, name: s.name, audience: s.audience, subject: s.email.subject, html: s.email.html }));
  }

  /** Sends sample number `id` from samples() to `to`, so an admin can see it in a real inbox. */
  sendSample(id: number, to: string): Promise<EmailResult> | null {
    const s = samples(this.context, this.fromHeader)[id];
    return s ? this.sendEmail(to, { ...s.email, subject: `[Sample] ${s.email.subject}` }) : null;
  }

  sendTest(to: string): Promise<EmailResult> {
    return this.sendEmail(to, templates.test(this.context, { from: this.fromHeader }));
  }

  async sendWelcome(to: string, firstName: string): Promise<void> {
    await this.sendEmail(to, templates.welcome(this.context, { firstName, email: to }));
  }

  async sendTranscriptStatus(to: string, firstName: string, transcriptId: string, status: string, notes?: string): Promise<void> {
    await this.sendEmail(to, templates.transcriptStatus(this.context, { firstName, transcriptId, status, notes }));
  }
}
