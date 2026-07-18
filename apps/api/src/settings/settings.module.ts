import { Body, Controller, Delete, Get, Global, Injectable, Logger, Module, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';
import { AuthUser, CurrentUser } from '../auth/current-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthModule } from '../auth/auth.module';

/** Known integration settings — DB value (encrypted) overrides the env fallback. */
interface Def { key: string; env: keyof AppEnv; label: string; secret: boolean; group: string }
type AppEnv = {
  anthropicApiKey: string;
  aiModel: string;
  resendApiKey: string;
  emailFrom: string;
  telegramBotToken: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  whatsappFrom: string;
  smsFrom: string;
  signalCliUrl: string;
  signalFrom: string;
  alertTelegramChatId: string;
  alertEmail: string;
  bakongDisbursementToken: string;
  trusteeBaseUrl: string;
  trusteeRequestSigningPrivateKey: string;
  trusteeRequestSigningKeyId: string;
  trusteeArtifactSigningPrivateKey: string;
  trusteeArtifactSigningKeyId: string;
};

const DEFS: Def[] = [
  { key: 'anthropic_api_key', env: 'anthropicApiKey', label: 'Anthropic API key (AI Copilot)', secret: true, group: 'AI' },
  { key: 'ai_model', env: 'aiModel', label: 'AI model', secret: false, group: 'AI' },
  { key: 'resend_api_key', env: 'resendApiKey', label: 'Resend API key (email)', secret: true, group: 'Email' },
  { key: 'email_from', env: 'emailFrom', label: 'Email “from” address', secret: false, group: 'Email' },
  { key: 'telegram_bot_token', env: 'telegramBotToken', label: 'Telegram bot token', secret: true, group: 'Messaging' },
  { key: 'twilio_account_sid', env: 'twilioAccountSid', label: 'Twilio account SID (WhatsApp/SMS)', secret: true, group: 'Messaging' },
  { key: 'twilio_auth_token', env: 'twilioAuthToken', label: 'Twilio auth token', secret: true, group: 'Messaging' },
  { key: 'whatsapp_from', env: 'whatsappFrom', label: 'WhatsApp from number', secret: false, group: 'Messaging' },
  { key: 'sms_from', env: 'smsFrom', label: 'SMS from number', secret: false, group: 'Messaging' },
  { key: 'signal_cli_url', env: 'signalCliUrl', label: 'Signal-cli REST URL', secret: false, group: 'Messaging' },
  { key: 'signal_from', env: 'signalFrom', label: 'Signal from number', secret: false, group: 'Messaging' },
  { key: 'alert_telegram_chat_id', env: 'alertTelegramChatId', label: 'Ops alert Telegram chat id', secret: false, group: 'Alerts' },
  { key: 'alert_email', env: 'alertEmail', label: 'Ops alert email address', secret: false, group: 'Alerts' },
  { key: 'bakong_disbursement_token', env: 'bakongDisbursementToken', label: 'Bakong disbursement token (automated payouts)', secret: true, group: 'Payouts' },
  { key: 'trustee_base_url', env: 'trusteeBaseUrl', label: 'Trustee base URL', secret: false, group: 'Trustee' },
  { key: 'trustee_request_signing_private_key', env: 'trusteeRequestSigningPrivateKey', label: 'Trustee request-signing private key', secret: true, group: 'Trustee' },
  { key: 'trustee_request_signing_key_id', env: 'trusteeRequestSigningKeyId', label: 'Trustee request-signing key id', secret: false, group: 'Trustee' },
  { key: 'trustee_artifact_signing_private_key', env: 'trusteeArtifactSigningPrivateKey', label: 'Trustee artifact-signing private key', secret: true, group: 'Trustee' },
  { key: 'trustee_artifact_signing_key_id', env: 'trusteeArtifactSigningKeyId', label: 'Trustee artifact-signing key id', secret: false, group: 'Trustee' },
];
const DEF_BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

@Injectable()
export class SettingsService {
  private readonly logger = new Logger('Settings');
  // Small TTL cache so hot paths (email/AI) don't hit the DB + decrypt each call.
  private cache = new Map<string, { value: string | undefined; at: number }>();
  private readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly config: ConfigService) {}

  /** Resolve a setting: decrypted DB value if present, else the env fallback. */
  async resolve(key: string): Promise<string | undefined> {
    const def = DEF_BY_KEY.get(key);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.TTL_MS) return cached.value;

    let value: string | undefined;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (row) {
      try { value = this.crypto.decrypt(row.valueCiphertext); } catch (e) { this.logger.error(`decrypt failed for ${key}: ${e}`); }
    }
    if (value === undefined && def) value = this.config.get<string>(def.env);
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  private async assertAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  /** Admin: list settings with source + a masked preview (never the raw secret). */
  async list(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const rows = await this.prisma.systemSetting.findMany();
    const dbKeys = new Set(rows.map((r) => r.key));
    return {
      settings: await Promise.all(DEFS.map(async (d) => {
        const value = await this.resolve(d.key);
        const source = dbKeys.has(d.key) ? 'db' : value ? 'env' : 'unset';
        return { key: d.key, label: d.label, group: d.group, secret: d.secret, configured: !!value, source, preview: this.mask(value, d.secret) };
      })),
    };
  }

  async set(user: AuthUser, key: string, value: string) {
    await this.assertAdmin(user.userId);
    if (!DEF_BY_KEY.has(key)) throw ApiError.invalidRequest(`Unknown setting: ${key}`);
    if (!value) throw ApiError.invalidRequest('Value required');
    const ciphertext = this.crypto.encrypt(value);
    await this.prisma.systemSetting.upsert({ where: { key }, create: { key, valueCiphertext: ciphertext, updatedByUserId: user.userId }, update: { valueCiphertext: ciphertext, updatedByUserId: user.userId } });
    this.cache.delete(key);
    this.logger.log(`system setting updated: ${key} by ${user.userId}`);
    return { key, configured: true, source: 'db' };
  }

  async clear(user: AuthUser, key: string) {
    await this.assertAdmin(user.userId);
    await this.prisma.systemSetting.deleteMany({ where: { key } });
    this.cache.delete(key);
    return { key, cleared: true };
  }

  private mask(value: string | undefined, secret: boolean): string | null {
    if (!value) return null;
    if (!secret) return value;
    return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }
}

class SetSettingDto {
  @IsString() value!: string;
}

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'List platform integration settings (admin)' })
  list(@CurrentUser() user: AuthUser) {
    return this.settings.list(user);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Set an integration setting (encrypted at rest)' })
  set(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settings.set(user, key, dto.value);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Clear a setting (fall back to env var)' })
  clear(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.settings.clear(user, key);
  }
}

// Core provider is @Global with NO auth dependency, so EmailService/LlmService
// can resolve it without creating a cycle (SettingsController→AuthModule).
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsCoreModule {}

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
