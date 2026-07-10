import { Controller, Get, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_MAINTENANCE, QUEUE_WEBHOOK } from '../queue/queue.constants';
import { PAYMENT_PROVIDER, PaymentProvider } from '../providers/payment-provider.interface';

/**
 * Operational metrics (aggregate, no PII). Suitable for a status board or a
 * lightweight scrape. Prometheus text format can be added later if needed.
 */
@ApiTags('health')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WEBHOOK) private readonly webhookQueue: Queue,
    @InjectQueue(QUEUE_MAINTENANCE) private readonly maintenanceQueue: Queue,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Aggregate operational metrics' })
  async metrics() {
    const [byStatus, deliveryByStatus, webhookCounts, maintenanceCounts, providerHealth] =
      await Promise.all([
        this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.webhookDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
        this.webhookQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        this.maintenanceQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        this.provider.getProviderHealth().catch(() => ({ healthy: false, latencyMs: undefined })),
      ]);

    const p: Record<string, number> = {};
    let total = 0;
    for (const r of byStatus) {
      p[r.status.toLowerCase()] = r._count._all;
      total += r._count._all;
    }
    const paid = p['paid'] ?? 0;
    const d: Record<string, number> = {};
    for (const r of deliveryByStatus) d[r.status.toLowerCase()] = r._count._all;

    return {
      payments: {
        total,
        paid,
        pending: p['pending'] ?? 0,
        scanned: p['scanned'] ?? 0,
        failed: p['failed'] ?? 0,
        expired: p['expired'] ?? 0,
        cancelled: p['cancelled'] ?? 0,
        success_rate: total > 0 ? Number(((paid / total) * 100).toFixed(2)) : 0,
      },
      webhooks: {
        deliveries_succeeded: d['succeeded'] ?? 0,
        deliveries_failed: d['failed'] ?? 0,
        deliveries_pending: d['pending'] ?? 0,
      },
      queues: {
        webhook: webhookCounts,
        maintenance: maintenanceCounts,
      },
      provider: {
        name: this.provider.name,
        healthy: providerHealth.healthy,
        latency_ms: providerHealth.latencyMs ?? null,
      },
      generated_at: new Date().toISOString(),
    };
  }
}
