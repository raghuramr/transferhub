import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

/**
 * Thin wrapper around Resend (https://resend.com). If RESEND_API_KEY is not
 * configured, `send` logs a warning and no-ops — local dev without the key
 * must keep working, and callers should never have user-facing flows (like
 * account creation) fail because an email could not be sent.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn(`RESEND_API_KEY not set — skipping email to ${to}: "${subject}"`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }
}
