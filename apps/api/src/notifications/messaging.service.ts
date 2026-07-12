import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannelType } from '@prisma/client';
import { SettingsService } from '../settings/settings.module';

/**
 * Outbound messaging transports for WhatsApp / SMS / Signal. WhatsApp & SMS use
 * Twilio's REST API; Signal uses a signal-cli REST bridge. Credentials are
 * resolved at send time from system settings (encrypted DB value → env
 * fallback), so they can be set in the admin console or via env. When a
 * channel's credentials are unset it falls back to a log transport.
 * Best-effort — sends never throw into the caller.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('Messaging');

  constructor(private readonly settings: SettingsService) {}

  private async creds() {
    const [twilioSid, twilioToken, whatsappFrom, smsFrom, signalUrl, signalFrom] = await Promise.all([
      this.settings.resolve('twilio_account_sid'),
      this.settings.resolve('twilio_auth_token'),
      this.settings.resolve('whatsapp_from'),
      this.settings.resolve('sms_from'),
      this.settings.resolve('signal_cli_url'),
      this.settings.resolve('signal_from'),
    ]);
    return { twilioSid, twilioToken, whatsappFrom, smsFrom, signalUrl, signalFrom };
  }

  /** Whether the given channel has real provider credentials configured. */
  async configured(channel: NotificationChannelType): Promise<boolean> {
    const c = await this.creds();
    switch (channel) {
      case 'WHATSAPP': return !!(c.twilioSid && c.twilioToken && c.whatsappFrom);
      case 'SMS': return !!(c.twilioSid && c.twilioToken && c.smsFrom);
      case 'SIGNAL': return !!(c.signalUrl && c.signalFrom);
    }
  }

  async send(channel: NotificationChannelType, destination: string, text: string): Promise<boolean> {
    const c = await this.creds();
    const ok = channel === 'WHATSAPP' ? !!(c.twilioSid && c.twilioToken && c.whatsappFrom)
      : channel === 'SMS' ? !!(c.twilioSid && c.twilioToken && c.smsFrom)
      : !!(c.signalUrl && c.signalFrom);
    if (!ok) {
      this.logger.log(`[log-transport] ${channel.toLowerCase()} to ${destination}: ${text.replace(/\n/g, ' ')}`);
      return true;
    }
    try {
      if (channel === 'SIGNAL') return await this.sendSignal(c.signalUrl!, c.signalFrom!, destination, text);
      return await this.sendTwilio(c, channel, destination, text);
    } catch (err) {
      this.logger.error(`${channel} send error: ${err}`);
      return false;
    }
  }

  private async sendTwilio(c: { twilioSid?: string; twilioToken?: string; whatsappFrom?: string; smsFrom?: string }, channel: NotificationChannelType, destination: string, text: string): Promise<boolean> {
    const from = channel === 'WHATSAPP' ? `whatsapp:${c.whatsappFrom}` : (c.smsFrom as string);
    const to = channel === 'WHATSAPP' ? `whatsapp:${destination}` : destination;
    const body = new URLSearchParams({ From: from, To: to, Body: text });
    const auth = Buffer.from(`${c.twilioSid}:${c.twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.twilioSid}/Messages.json`, {
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

  private async sendSignal(signalUrl: string, signalFrom: string, destination: string, text: string): Promise<boolean> {
    const res = await fetch(`${signalUrl.replace(/\/$/, '')}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, number: signalFrom, recipients: [destination] }),
    });
    if (!res.ok) {
      this.logger.error(`Signal send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  }
}
