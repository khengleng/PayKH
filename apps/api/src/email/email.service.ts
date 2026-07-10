import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Transactional email via Resend (https://resend.com). When RESEND_API_KEY is
 * unset, falls back to a log transport so non-prod environments work without an
 * email provider. Sends are best-effort and never throw into the caller.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private readonly apiKey?: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('resendApiKey');
    this.from = config.get<string>('emailFrom') as string;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.apiKey) {
      this.logger.log(`[log-transport] email to=${message.to} subject="${message.subject}"`);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Resend send failed (${res.status}): ${body}`);
      } else {
        this.logger.log(`sent email to=${message.to} subject="${message.subject}"`);
      }
    } catch (err) {
      this.logger.error(`Resend send error: ${err}`);
    }
  }
}
