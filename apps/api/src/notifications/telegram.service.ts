import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.module';

/**
 * Telegram Bot API sender. The bot token is resolved at send time from system
 * settings (encrypted DB value → env fallback), so it can be set in the admin
 * console or via env. When no token is configured it falls back to a log
 * transport. Sends are best-effort and never throw into the caller.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger('Telegram');

  constructor(private readonly settings: SettingsService) {}

  async configured(): Promise<boolean> {
    return !!(await this.settings.resolve('telegram_bot_token'));
  }

  async send(chatId: string, text: string): Promise<boolean> {
    const token = await this.settings.resolve('telegram_bot_token');
    if (!token) {
      this.logger.log(`[log-transport] telegram to chat=${chatId}: ${text.replace(/\n/g, ' ')}`);
      return true;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (!res.ok) {
        this.logger.error(`Telegram send failed (${res.status}): ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Telegram send error: ${err}`);
      return false;
    }
  }
}
