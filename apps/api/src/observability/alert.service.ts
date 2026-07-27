import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../settings/settings.module';
import { EmailService } from '../email/email.service';
import { captureMessage } from './sentry';
import { registerAlertSink, AlertPayload } from './alert-sink';

/**
 * Operational alerting. A single funnel for "an operator needs to know NOW"
 * events — unhandled 5xx errors, failed payouts, reconciliation breaks. Fans
 * each alert out to the enabled channels and is strictly best-effort: it logs,
 * dedupes a storm, and never throws into the caller.
 *
 * Targets resolve from system settings (encrypted DB → env), so an operator can
 * point alerts at their own Telegram chat / inbox from the admin console with
 * no redeploy.
 *
 * `alert_channels` decides which channels fire. It defaults to Telegram only:
 * an ops alert is a push-to-phone signal, and duplicating every one into an
 * inbox trains operators to filter the mailbox that also carries the alerts
 * they must not miss. Sentry is not a channel here — it always receives the
 * event (a no-op without SENTRY_DSN) because it is the durable record.
 */
@Injectable()
export class AlertService implements OnModuleInit {
  private readonly logger = new Logger('Alert');
  // Suppress identical alerts within this window so one failing dependency
  // doesn't spam the operator's phone.
  private readonly recent = new Map<string, number>();
  private readonly DEDUPE_MS = 5 * 60_000;
  private static readonly DEFAULT_CHANNELS = 'telegram';

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

    const channels = await this.enabledChannels();
    const sends: Promise<void>[] = [];
    if (channels.has('telegram')) sends.push(this.toTelegram(title, detail));
    if (channels.has('email')) sends.push(this.toEmail(title, detail));
    await Promise.allSettled(sends);
  }

  /**
   * Which channels are switched on. Unset means the default (Telegram); an
   * explicit empty value means "log + Sentry only" and is honoured as such.
   */
  private async enabledChannels(): Promise<Set<string>> {
    const raw = await this.settings.resolve('alert_channels');
    const value = raw ?? AlertService.DEFAULT_CHANNELS;
    return new Set(value.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean));
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
    const [chatId, mail, enabled] = await Promise.all([
      this.settings.resolve('alert_telegram_chat_id'),
      this.settings.resolve('alert_email'),
      this.enabledChannels(),
    ]);
    await this.critical('Test alert', 'This is a test of PayKH operational alerting. If you received it, alerts are wired.');
    // A channel only delivers if it is both switched on and has a target, so
    // report the conjunction — a configured-but-disabled channel sends nothing.
    return {
      dispatched: true,
      channels: {
        sentry: true, // no-op unless SENTRY_DSN set; always attempted
        telegram: enabled.has('telegram') && !!chatId,
        email: enabled.has('email') && !!mail,
      },
      enabled_channels: [...enabled],
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
