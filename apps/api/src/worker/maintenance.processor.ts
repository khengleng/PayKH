import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BillingService } from '../billing/billing.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../providers/payment-provider.interface';
import {
  JOB_BILLING_SWEEP,
  JOB_EXPIRY_SWEEP,
  JOB_IDEMPOTENCY_CLEANUP,
  JOB_STATUS_POLL,
  QUEUE_MAINTENANCE,
} from '../queue/queue.constants';

const BATCH = 200;

/**
 * Periodic maintenance:
 *  - expiry-sweep:        proactively expire pending/scanned payments (fires webhooks)
 *  - status-poll:         poll the provider for live pending payments (Bakong)
 *  - idempotency-cleanup: purge expired idempotency records
 */
@Processor(QUEUE_MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger('Maintenance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly billing: BillingService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_EXPIRY_SWEEP:
        return this.expirySweep();
      case JOB_STATUS_POLL:
        return this.statusPoll();
      case JOB_IDEMPOTENCY_CLEANUP:
        return this.idempotencyCleanup();
      case JOB_BILLING_SWEEP:
        return this.billing.sweep();
      default:
        return;
    }
  }

  private async expirySweep(): Promise<void> {
    const due = await this.prisma.payment.findMany({
      where: { status: { in: ['PENDING', 'SCANNED'] }, expiresAt: { lt: new Date() } },
      select: { id: true },
      take: BATCH,
    });
    let expired = 0;
    for (const p of due) {
      try {
        await this.payments.transition(p.id, 'expired', 'expired (sweep)');
        expired++;
      } catch (err) {
        this.logger.warn(`expiry sweep failed for ${p.id}: ${err}`);
      }
    }
    if (expired) this.logger.log(`expiry sweep: expired ${expired} payment(s)`);
  }

  private async statusPoll(): Promise<void> {
    // Only meaningful for a provider that is the source of truth (Bakong).
    if (this.provider.name === 'mock') return;

    const pending = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'SCANNED'] },
        mode: 'LIVE',
        expiresAt: { gt: new Date() },
      },
      include: { providerReference: true },
      take: BATCH,
    });

    for (const payment of pending) {
      const md5 = payment.providerReference?.md5;
      if (!md5) continue;
      try {
        const result = await this.provider.checkPaymentStatus({ md5 });
        if (result.state === 'paid') {
          await this.payments.transition(payment.id, 'paid', 'confirmed via provider poll');
        } else if (result.state === 'failed') {
          await this.payments.transition(payment.id, 'failed', 'failed per provider poll');
        }
      } catch (err) {
        this.logger.warn(`status poll failed for ${payment.id}: ${err}`);
      }
    }
  }

  private async idempotencyCleanup(): Promise<void> {
    const { count } = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count) this.logger.log(`idempotency cleanup: removed ${count} expired record(s)`);
  }
}
