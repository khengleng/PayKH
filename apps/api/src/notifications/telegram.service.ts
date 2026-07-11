import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Telegram Bot API sender. When TELEGRAM_BOT_TOKEN is unset it falls back to a
 * log transport so non-prod works without a bot (mirrors EmailService). Sends
 * are best-effort and never throw into the caller.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger('Telegram');
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('telegramBotToken');
  }

  get configured(): boolean {
    return !!this.token;
  }

  async send(chatId: string, text: string): Promise<boolean> {
    if (!this.token) {
      this.logger.log(`[log-transport] telegram to chat=${chatId}: ${text.replace(/\n/g, ' ')}`);
      return true;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
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
