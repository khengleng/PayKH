import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.module';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Transactional email via Resend (https://resend.com). The API key + from
 * address are resolved at send time from system settings (encrypted DB value →
 * env fallback), so an admin can configure Resend in-app without a redeploy.
 * When no key is configured it falls back to a log transport. Best-effort —
 * never throws into the caller.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');

  constructor(private readonly config: ConfigService, private readonly settings: SettingsService) {}

  async send(message: EmailMessage): Promise<void> {
    const apiKey = await this.settings.resolve('resend_api_key');
    const from = (await this.settings.resolve('email_from')) ?? 'PayKH <noreply@paykh.cambobia.com>';
    if (!apiKey) {
      this.logger.log(`[log-transport] email to=${message.to} subject="${message.subject}"`);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
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
