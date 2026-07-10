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
  bakongApiBaseUrl?: string;
  bakongApiToken?: string;
  bakongPlatformAccount?: string;
  resendApiKey?: string;
  emailFrom: string;
  sentryDsn?: string;
  metricsToken?: string;
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
    bakongApiBaseUrl: process.env.BAKONG_API_BASE_URL,
    bakongApiToken: process.env.BAKONG_API_TOKEN,
    bakongPlatformAccount: process.env.BAKONG_PLATFORM_ACCOUNT,
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM ?? 'PayKH <noreply@paykh.cambobia.com>',
    sentryDsn: process.env.SENTRY_DSN,
    metricsToken: process.env.METRICS_TOKEN,
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
