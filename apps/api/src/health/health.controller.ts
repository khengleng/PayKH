import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../providers/payment-provider.interface';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Liveness: process is up. */
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }

  /** Readiness: dependencies (DB, provider) are reachable. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (DB + provider)' })
  async ready() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, detail: (err as Error).message };
    }
    try {
      const health = await this.provider.getProviderHealth();
      checks.provider = { ok: health.healthy, detail: health.detail };
    } catch (err) {
      checks.provider = { ok: false, detail: (err as Error).message };
    }
    const ok = Object.values(checks).every((c) => c.ok);
    return { status: ok ? 'ready' : 'degraded', provider: this.provider.name, checks };
  }
}
