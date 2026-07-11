import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannelType } from '@prisma/client';

/**
 * Outbound messaging transports for WhatsApp / SMS / Signal. WhatsApp & SMS use
 * Twilio's REST API; Signal uses a signal-cli REST bridge. When a channel's
 * credentials are unset it falls back to a log transport (mirrors TelegramService
 * / EmailService) so non-prod works without provider accounts. Best-effort —
 * sends never throw into the caller.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');
  private readonly twilioSid?: string;
  private readonly twilioToken?: string;
  private readonly whatsappFrom?: string;
  private readonly smsFrom?: string;
  private readonly signalUrl?: string;
  private readonly signalFrom?: string;

  constructor(config: ConfigService) {
    this.twilioSid = config.get<string>('twilioAccountSid');
    this.twilioToken = config.get<string>('twilioAuthToken');
    this.whatsappFrom = config.get<string>('whatsappFrom');
    this.smsFrom = config.get<string>('smsFrom');
    this.signalUrl = config.get<string>('signalCliUrl');
    this.signalFrom = config.get<string>('signalFrom');
  }

  /** Whether the given channel has real provider credentials configured. */
  configured(channel: NotificationChannelType): boolean {
    switch (channel) {
      case 'WHATSAPP':
        return !!(this.twilioSid && this.twilioToken && this.whatsappFrom);
      case 'SMS':
        return !!(this.twilioSid && this.twilioToken && this.smsFrom);
      case 'SIGNAL':
        return !!(this.signalUrl && this.signalFrom);
    }
  }

  async send(channel: NotificationChannelType, destination: string, text: string): Promise<boolean> {
    if (!this.configured(channel)) {
      this.logger.log(`[log-transport] ${channel.toLowerCase()} to ${destination}: ${text.replace(/\n/g, ' ')}`);
      return true;
    }
    try {
      if (channel === 'SIGNAL') return await this.sendSignal(destination, text);
      return await this.sendTwilio(channel, destination, text);
    } catch (err) {
      this.logger.error(`${channel} send error: ${err}`);
      return false;
    }
  }

  private async sendTwilio(channel: NotificationChannelType, destination: string, text: string): Promise<boolean> {
    const from = channel === 'WHATSAPP' ? `whatsapp:${this.whatsappFrom}` : (this.smsFrom as string);
    const to = channel === 'WHATSAPP' ? `whatsapp:${destination}` : destination;
    const body = new URLSearchParams({ From: from, To: to, Body: text });
    const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      this.logger.error(`${channel} (Twilio) send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  }

  private async sendSignal(destination: string, text: string): Promise<boolean> {
    const res = await fetch(`${this.signalUrl!.replace(/\/$/, '')}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, number: this.signalFrom, recipients: [destination] }),
    });
    if (!res.ok) {
      this.logger.error(`Signal send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  }
}
