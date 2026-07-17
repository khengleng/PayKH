export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl?: string;
  jwtSecret: string;
  encryptionKey: string;
  appBaseUrl: string;
  checkoutBaseUrl: string;
  dashboardBaseUrl: string;
  paymentProvider: 'mock' | 'bakong';
  /** Digital-value provider (loyalty points). 'paychain' lands with credentials. */
  digitalValueProvider: 'mock' | 'paychain';
  bakongApiBaseUrl?: string;
  bakongApiToken?: string;
  bakongPlatformAccount?: string;
  resendApiKey?: string;
  emailFrom: string;
  sentryDsn?: string;
  metricsToken?: string;
  telegramBotToken?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  whatsappFrom?: string;
  smsFrom?: string;
  signalCliUrl?: string;
  signalFrom?: string;
  anthropicApiKey?: string;
  aiModel: string;
  alertTelegramChatId?: string;
  alertEmail?: string;
  bakongDisbursementToken?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.API_PORT ?? 4000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL,
    jwtSecret: required('JWT_SECRET'),
    encryptionKey: required('ENCRYPTION_KEY'),
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:4000',
    checkoutBaseUrl: process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3001',
    dashboardBaseUrl: process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000',
    paymentProvider: (process.env.PAYMENT_PROVIDER as 'mock' | 'bakong') ?? 'mock',
    digitalValueProvider: (process.env.DIGITAL_VALUE_PROVIDER as 'mock' | 'paychain') ?? 'mock',
    bakongApiBaseUrl: process.env.BAKONG_API_BASE_URL,
    bakongApiToken: process.env.BAKONG_API_TOKEN,
    bakongPlatformAccount: process.env.BAKONG_PLATFORM_ACCOUNT,
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM ?? 'PayKH <noreply@paykh.cambobia.com>',
    sentryDsn: process.env.SENTRY_DSN,
    metricsToken: process.env.METRICS_TOKEN,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappFrom: process.env.WHATSAPP_FROM,
    smsFrom: process.env.SMS_FROM,
    signalCliUrl: process.env.SIGNAL_CLI_URL,
    signalFrom: process.env.SIGNAL_FROM,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    aiModel: process.env.AI_MODEL ?? 'claude-haiku-4-5-20251001',
    alertTelegramChatId: process.env.ALERT_TELEGRAM_CHAT_ID,
    alertEmail: process.env.ALERT_EMAIL,
    bakongDisbursementToken: process.env.BAKONG_DISBURSEMENT_TOKEN,
  };
}

/** Validate config at boot; throws if misconfigured. */
export function validateConfig(): AppConfig {
  const cfg = loadConfig();
  // Fail fast on a bad encryption key length.
  const keyBytes = Buffer.from(cfg.encryptionKey, 'hex');
  if (keyBytes.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes hex-encoded (64 hex chars)');
  }
  if (cfg.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters');
  }
  return cfg;
}
