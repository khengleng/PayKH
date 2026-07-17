import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { BillingService } from '../billing/billing.service';
import { SettlementService } from '../settlements/settlement.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import { ReconciliationService } from '../ledger/reconciliation.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AlertService } from '../observability/alert.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../providers/payment-provider.interface';
import {
  JOB_BILLING_SWEEP,
  JOB_EXPIRY_SWEEP,
  JOB_IDEMPOTENCY_CLEANUP,
  JOB_POINTS_EXPIRY,
  JOB_POINTS_RECONCILE,
  JOB_SETTLEMENT_SWEEP,
  JOB_STATUS_POLL,
  JOB_WEBHOOK_RECONCILE,
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
    private readonly settlement: SettlementService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly reconciliation: ReconciliationService,
    private readonly loyalty: LoyaltyService,
    private readonly alerts: AlertService,
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
      case JOB_SETTLEMENT_SWEEP:
        return this.settlementSweep();
      case JOB_WEBHOOK_RECONCILE:
        await this.webhookEvents.reconcilePending();
        return;
      case JOB_POINTS_RECONCILE:
        return this.pointsReconcile();
      case JOB_POINTS_EXPIRY:
        return this.pointsExpiry();
      default:
        return;
    }
  }

  /**
   * Points drift watch: does every customer's balance column still agree with
   * the ledger's points_liability position?
   *
   * They are written in one transaction, so a break is never routine — it means
   * value moved without a journal, or a journal exists with no value behind it.
   * Catching that here is what makes the PayChain migration's dual-run stages
   * trustworthy: comparing PayKH against PayChain is meaningless if PayKH does
   * not agree with itself first.
   */
  private async pointsReconcile(): Promise<void> {
    const r = await this.reconciliation.pointsDrift();
    if (r.ok) {
      this.logger.debug(`points reconcile: ${r.customers_checked} customers, liability ${r.liability_ledger} — clean`);
      return;
    }
    const sample = r.drifted
      .slice(0, 5)
      .map((d) => `${d.customer_id} column=${d.column} ledger=${d.ledger}`)
      .join('; ');
    this.logger.error(`points drift: ${r.drift_count} customer(s); liability column=${r.liability_column} ledger=${r.liability_ledger}`);
    await this.alerts.critical(
      'Loyalty points ledger drift',
      `${r.drift_count} customer(s) disagree with the ledger. Liability: column ${r.liability_column} vs ledger ${r.liability_ledger} (delta ${r.liability_delta}). Sample: ${sample}`,
      { drift_count: r.drift_count, liability_delta: r.liability_delta },
    );
  }

  /** Age out points past each program's rolling expiry window. */
  private async pointsExpiry(): Promise<void> {
    // Only stores that have opted in have a window set; the rest are a no-op.
    const programs = await this.prisma.loyaltyProgram.findMany({
      where: { active: true, expiryMonths: { not: null } },
      select: { storeId: true },
    });
    for (const p of programs) {
      try {
        await this.loyalty.expireForStore(p.storeId);
      } catch (err) {
        this.logger.warn(`points expiry failed for store ${p.storeId}: ${err}`);
      }
    }
  }

  /** Settle each store's completed-day paid payments into daily batches. */
  private async settlementSweep(): Promise<void> {
    const stores = await this.prisma.store.findMany({ select: { id: true }, take: 1000 });
    for (const store of stores) {
      try {
        await this.settlement.runForStore(store.id, false);
      } catch (err) {
        this.logger.warn(`settlement sweep failed for store ${store.id}: ${err}`);
      }
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
