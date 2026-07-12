import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../settings/settings.module';
import { EmailService } from '../email/email.service';
import { captureMessage } from './sentry';
import { registerAlertSink, AlertPayload } from './alert-sink';

/**
 * Operational alerting. A single funnel for "an operator needs to know NOW"
 * events — unhandled 5xx errors, failed payouts, reconciliation breaks. Fans
 * each alert out to every configured channel (Sentry, Telegram, email) and is
 * strictly best-effort: it logs, dedupes a storm, and never throws into the
 * caller.
 *
 * Targets resolve from system settings (encrypted DB → env), so an operator can
 * point alerts at their own Telegram chat / inbox from the admin console with
 * no redeploy.
 */
@Injectable()
export class AlertService implements OnModuleInit {
  private readonly logger = new Logger('Alert');
  // Suppress identical alerts within this window so one failing dependency
  // doesn't spam the operator's phone.
  private readonly recent = new Map<string, number>();
  private readonly DEDUPE_MS = 5 * 60_000;

  constructor(private readonly settings: SettingsService, private readonly email: EmailService) {}

  onModuleInit(): void {
    // Let the DI-free exception filter route 5xx errors through here.
    registerAlertSink((p: AlertPayload) => void this.critical(p.title, p.detail, p.context));
  }

  /** Fire a critical alert to every configured channel (best-effort). */
  async critical(title: string, detail: string, context?: Record<string, unknown>): Promise<void> {
    const key = `${title}|${detail}`.slice(0, 200);
    const now = Date.now();
    const last = this.recent.get(key);
    if (last && now - last < this.DEDUPE_MS) return;
    this.recent.set(key, now);
    if (this.recent.size > 500) this.recent.clear();

    this.logger.error(`ALERT: ${title} — ${detail}`);
    captureMessage(`${title}: ${detail}`, context);

    await Promise.allSettled([this.toTelegram(title, detail), this.toEmail(title, detail)]);
  }

  private async toTelegram(title: string, detail: string): Promise<void> {
    const [token, chatId] = await Promise.all([
      this.settings.resolve('telegram_bot_token'),
      this.settings.resolve('alert_telegram_chat_id'),
    ]);
    if (!token || !chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `🚨 <b>${escapeHtml(title)}</b>\n${escapeHtml(detail)}`, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
    } catch (err) {
      this.logger.warn(`alert telegram failed: ${err}`);
    }
  }

  private async toEmail(title: string, detail: string): Promise<void> {
    const to = await this.settings.resolve('alert_email');
    if (!to) return;
    await this.email.send({
      to,
      subject: `[PayKH alert] ${title}`,
      html: `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><p style="color:#888">PayKH operational alert.</p>`,
      text: `${title}\n\n${detail}`,
    });
  }

  /** Admin: send a test alert and report which channels are wired. */
  async test() {
    const [chatId, mail] = await Promise.all([
      this.settings.resolve('alert_telegram_chat_id'),
      this.settings.resolve('alert_email'),
    ]);
    await this.critical('Test alert', 'This is a test of PayKH operational alerting. If you received it, alerts are wired.');
    return {
      dispatched: true,
      channels: {
        sentry: true, // no-op unless SENTRY_DSN set; always attempted
        telegram: !!chatId,
        email: !!mail,
      },
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
