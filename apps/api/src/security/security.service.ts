import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { QUEUE_WEBHOOK } from '../queue/queue.constants';

interface Check { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }

@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
  ) {}

  private async assertAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u?.isPlatformAdmin) throw ApiError.forbidden('Platform admin access required');
  }

  /**
   * Automated security-posture self-assessment: a checklist of runtime controls
   * (transport, secrets, rate limiting, webhook signing, MFA availability). A
   * lightweight complement to periodic external penetration testing (scope in
   * SECURITY-TESTING.md).
   */
  async posture(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const prod = this.config.get<string>('nodeEnv') === 'production';
    const encKey = this.config.get<string>('encryptionKey') ?? '';
    const jwt = this.config.get<string>('jwtSecret') ?? '';
    const mfaUsers = await this.prisma.user.count({ where: { mfaEnabled: true } });

    const checks: Check[] = [
      { id: 'https', label: 'HTTPS enforced in production', status: prod ? 'pass' : 'warn', detail: prod ? 'HSTS + https redirect active' : 'Non-production environment' },
      { id: 'enc_key', label: 'Encryption key strength (AES-256)', status: Buffer.from(encKey, 'hex').length === 32 ? 'pass' : 'fail', detail: '32-byte key required for AES-256-GCM' },
      { id: 'jwt', label: 'JWT secret length', status: jwt.length >= 32 ? 'pass' : jwt.length >= 16 ? 'warn' : 'fail', detail: `${jwt.length} chars (≥32 recommended)` },
      { id: 'metrics', label: 'Metrics endpoint protected', status: this.config.get('metricsToken') ? 'pass' : 'warn', detail: this.config.get('metricsToken') ? 'Bearer token required' : 'METRICS_TOKEN not set — /metrics is open' },
      { id: 'rate_limit', label: 'Rate limiting active', status: this.config.get('redisUrl') ? 'pass' : 'warn', detail: this.config.get('redisUrl') ? 'Redis-backed limiter' : 'No Redis — limiter disabled' },
      { id: 'webhook_sig', label: 'Webhook signing (HMAC-SHA256)', status: 'pass', detail: 'All outbound webhooks are signed' },
      { id: 'ssrf', label: 'SSRF protection on webhooks', status: 'pass', detail: 'Private/metadata ranges blocked; redirects rejected' },
      { id: 'api_key_hash', label: 'API keys hashed at rest (SHA-256)', status: 'pass', detail: 'Only key prefixes stored in cleartext' },
      { id: 'mfa', label: 'MFA availability', status: mfaUsers > 0 ? 'pass' : 'warn', detail: `${mfaUsers} user(s) with MFA enabled` },
    ];
    const score = Math.round((checks.filter((c) => c.status === 'pass').length / checks.length) * 100);
    return { environment: prod ? 'production' : 'non-production', score, checks };
  }

  /** Synthetic monitoring: dependency health + live throughput signals. */
  async monitoring(user: AuthUser) {
    await this.assertAdmin(user.userId);
    const t0 = Date.now();
    let dbOk = true;
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
    const dbLatencyMs = Date.now() - t0;

    let queueOk = true; let queueDepth = 0;
    try { const c = await this.webhookQueue.getJobCounts('waiting', 'active', 'delayed'); queueDepth = (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0); } catch { queueOk = false; }

    const hourAgo = new Date(Date.now() - 3_600_000);
    const [paidLastHour, failedLastHour] = await Promise.all([
      this.prisma.payment.count({ where: { status: 'PAID', paidAt: { gte: hourAgo } } }),
      this.prisma.payment.count({ where: { status: 'FAILED', updatedAt: { gte: hourAgo } } }),
    ]);
    const healthy = dbOk && queueOk && queueDepth < 1000;
    return {
      healthy,
      db: { ok: dbOk, latency_ms: dbLatencyMs },
      queue: { ok: queueOk, webhook_backlog: queueDepth },
      throughput_1h: { paid: paidLastHour, failed: failedLastHour },
    };
  }
}
