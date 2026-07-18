import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, Prisma, PaymentStatus as DbStatus } from '@prisma/client';
import { ids, prefixedId } from '@paykh/security';
import {
  canTransition,
  PaymentResource,
  PaymentStatus,
  RefundResource,
  STATUS_TO_EVENT,
} from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../providers/payment-provider.interface';
import { ApiKeyContext } from '../auth/api-key.guard';
import { validateAmount, formatAmount } from './amount.util';
import { CreatePaymentDto, ListPaymentsDto, RefundDto } from './dto';
import { Refund } from '@prisma/client';
import { PaymentEventsService } from './payment-events.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import { QuotaService } from '../billing/quota.service';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../branches/branches.service';
import { CustomersService } from '../customers/customers.service';
import { KhqrImportService } from '../khqr/khqr-import.module';
import { IdempotencyService } from '../idempotency/idempotency.module';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ReferralsService } from '../referrals/referrals.service';
import { GamesService } from '../games/games.service';
import { RiskService } from '../risk/risk.service';
import { LedgerService } from '../ledger/ledger.service';
import { ReceiptsService } from '../receipts/receipts.module';

const DEFAULT_EXPIRY_SECONDS = 300;

function toApiStatus(s: DbStatus): PaymentStatus {
  return s.toLowerCase() as PaymentStatus;
}
function toDbStatus(s: PaymentStatus): DbStatus {
  return s.toUpperCase() as DbStatus;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: PaymentEventsService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
    private readonly branches: BranchesService,
    private readonly customers: CustomersService,
    private readonly loyalty: LoyaltyService,
    private readonly referrals: ReferralsService,
    private readonly games: GamesService,
    private readonly risk: RiskService,
    private readonly ledger: LedgerService,
    private readonly receipts: ReceiptsService,
    private readonly khqr: KhqrImportService,
    private readonly idempotency: IdempotencyService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // --------------------------------------------------------------------- create
  async create(
    ctx: ApiKeyContext,
    dto: CreatePaymentDto,
    idempotencyKey: string | undefined,
    rawBody: string,
  ): Promise<{ resource: PaymentResource; status: number }> {
    // Scope the idempotency namespace by mode so the same key can't replay a
    // test-mode resource for a live-mode request (or vice versa) within a store.
    const endpoint = `POST /v1/payments:${ctx.mode}`;
    const requestHash = this.hashBody(rawBody);

    // Idempotency replay handling.
    if (idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          storeId_endpoint_idempotencyKey: {
            storeId: ctx.storeId,
            endpoint,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw ApiError.idempotencyConflict(
            'Idempotency-Key already used with a different request body',
          );
        }
        return {
          resource: existing.responseBody as unknown as PaymentResource,
          status: existing.responseStatus,
        };
      }
    }

    // Quota gate: reject new payment creation with HTTP 402 once the monthly
    // paid quota is reached (lookups + webhooks stay operational).
    await this.quota.assertWithinQuota(ctx.organizationId);

    const amount = validateAmount(dto.amount, dto.currency);
    const store = await this.prisma.store.findUnique({
      where: { id: ctx.storeId },
      include: { branding: true },
    });
    if (!store) throw ApiError.internal('Store missing for API key');

    // Optional branch attribution (must belong to this store and be active).
    let branchId: string | null = null;
    if (dto.branch_id) {
      branchId = await this.branches.resolveActive(ctx.storeId, dto.branch_id);
    }
    // Optional customer attribution (must belong to this store).
    let customerId: string | null = null;
    if (dto.customer_id) {
      customerId = await this.customers.resolveForStore(ctx.storeId, dto.customer_id);
    }

    const paymentId = ids.payment();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (dto.expires_in_seconds ?? DEFAULT_EXPIRY_SECONDS) * 1000,
    );

    // Generate the KHQR payload via the provider abstraction.
    let providerResult;
    try {
      providerResult = await this.provider.createKhqr({
        paymentId,
        storeId: ctx.storeId,
        mode: ctx.mode,
        amount: formatAmount(amount, dto.currency),
        currency: dto.currency,
        referenceId: dto.reference_id ?? null,
        description: dto.description ?? null,
        merchantName: store.branding?.displayName || store.name,
        merchantCity: 'Phnom Penh',
        expiresAt,
      });
    } catch (err) {
      // A provider ApiError (e.g. "no USD account connected") is user-actionable
      // — surface it as-is rather than masking it behind a generic 502.
      if (err instanceof ApiError) throw err;
      this.logger.error(`Provider createKhqr failed for ${paymentId}`, err as Error);
      throw ApiError.providerError('Failed to generate KHQR');
    }

    // Create the payment and (atomically) reserve the idempotency key in one
    // transaction, via the shared guard: its unique constraint on the record is
    // what stops two concurrent same-key requests from both creating a payment —
    // the loser's insert throws P2002, its whole tx (payment included) rolls
    // back, and the winner's response is replayed. The KHQR is generated above,
    // outside the tx, so a slow provider call never holds a row lock.
    let created: Payment | null = null;
    const { resource, replayed } = await this.idempotency.execute<PaymentResource>({
      scopeId: ctx.storeId,
      endpoint,
      key: idempotencyKey,
      rawBody,
      run: async (tx) => {
        const row = await tx.payment.create({
          data: {
            id: paymentId,
            storeId: ctx.storeId,
            apiKeyId: ctx.apiKeyId || null, // '' (link/dashboard-originated) → no api key
            mode: ctx.mode === 'live' ? 'LIVE' : 'TEST',
            status: 'PENDING',
            amount,
            currency: dto.currency,
            referenceId: dto.reference_id ?? null,
            description: dto.description ?? null,
            metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
            qrString: providerResult.qrString,
            branchId,
            customerId,
            expiresAt,
          },
        });
        await tx.paymentStatusHistory.create({
          data: { paymentId, fromStatus: null, toStatus: 'PENDING', reason: 'created' },
        });
        await tx.paymentProviderReference.create({
          data: {
            paymentId,
            provider: this.provider.name,
            md5: providerResult.md5,
            billNumber: providerResult.billNumber ?? null,
            rawResponse: (providerResult.raw ?? {}) as Prisma.InputJsonValue,
          },
        });
        created = row;
        return { resource: this.serialize(row), status: 201 };
      },
    });

    // Fire the created webhook only for a genuine first creation, never a replay.
    if (!replayed && created) {
      this.logger.log(`payment.created ${paymentId} amount=${resource.amount} ${resource.currency}`);
      await this.webhookEvents.emitCreated(created);
    }
    return { resource, status: 201 };
  }

  // ------------------------------------------------------------------- retrieve
  async retrieve(ctx: ApiKeyContext, id: string): Promise<PaymentResource> {
    const payment = await this.findScoped(ctx.storeId, id);
    const refreshed = await this.applyLazyExpiry(payment);
    return this.serialize(refreshed);
  }

  // ----------------------------------------------------------------------- list
  async list(ctx: ApiKeyContext, query: ListPaymentsDto) {
    const limit = query.limit ?? 20;
    const where: Prisma.PaymentWhereInput = { storeId: ctx.storeId };
    if (query.status) where.status = toDbStatus(query.status);
    if (query.reference_id) where.referenceId = query.reference_id;
    if (query.created_from || query.created_to) {
      where.createdAt = {};
      if (query.created_from) where.createdAt.gte = new Date(query.created_from);
      if (query.created_to) where.createdAt.lte = new Date(query.created_to);
    }

    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((p) => this.serialize(p));
    return {
      object: 'list' as const,
      data,
      has_more: hasMore,
      next_cursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  // --------------------------------------------------------------------- cancel
  async cancel(ctx: ApiKeyContext, id: string): Promise<PaymentResource> {
    const payment = await this.findScoped(ctx.storeId, id);
    const current = toApiStatus(payment.status);
    if (current === 'paid') {
      throw ApiError.invalidRequest('Cannot cancel a completed payment');
    }
    if (!canTransition(current, 'cancelled')) {
      throw ApiError.invalidRequest(`Cannot cancel a payment in status "${current}"`);
    }
    const updated = await this.transition(payment.id, 'cancelled', 'cancelled via API');
    return this.serialize(updated);
  }

  // --------------------------------------------------------------------- refund
  /**
   * Refund a paid payment (full or partial). Uses an optimistic lock on
   * refundedAmount to prevent double-refunds, supports idempotency keys, and
   * transitions the payment to `refunded` once fully refunded.
   */
  async refund(
    ctx: ApiKeyContext,
    paymentId: string,
    dto: RefundDto,
    idempotencyKey: string | undefined,
    rawBody: string,
  ): Promise<{ resource: RefundResource; status: number }> {
    const endpoint = `POST /v1/payments/${paymentId}/refund:${ctx.mode}`;
    const requestHash = this.hashBody(rawBody);

    if (idempotencyKey) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: { storeId_endpoint_idempotencyKey: { storeId: ctx.storeId, endpoint, idempotencyKey } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw ApiError.idempotencyConflict('Idempotency-Key already used with a different request body');
        }
        return { resource: existing.responseBody as unknown as RefundResource, status: existing.responseStatus };
      }
    }

    const payment = await this.findScoped(ctx.storeId, paymentId);
    if (toApiStatus(payment.status) !== 'paid') {
      throw ApiError.invalidRequest('Only paid payments can be refunded');
    }
    const total = payment.amount;
    const alreadyRefunded = payment.refundedAmount;
    const remaining = total.minus(alreadyRefunded);
    if (remaining.lessThanOrEqualTo(0)) {
      throw ApiError.invalidRequest('Payment is already fully refunded');
    }

    const refundAmount = dto.amount ? validateAmount(dto.amount, payment.currency) : remaining;
    if (refundAmount.lessThanOrEqualTo(0)) {
      throw ApiError.amountTooLow('Refund amount must be greater than 0');
    }
    if (refundAmount.greaterThan(remaining)) {
      throw ApiError.invalidRequest(
        `Refund amount exceeds refundable balance (${formatAmount(remaining, payment.currency)})`,
      );
    }

    // Ask the provider to process (mock succeeds; Bakong records manual intent).
    let providerResult;
    try {
      providerResult = await this.provider.refundPayment({
        paymentId,
        amount: formatAmount(refundAmount, payment.currency),
        currency: payment.currency,
        ref: { md5: undefined, billNumber: undefined },
      });
    } catch (err) {
      this.logger.error(`Provider refund failed for ${paymentId}`, err as Error);
      throw ApiError.providerError('Refund failed at provider');
    }
    if (!providerResult.ok) throw ApiError.providerError('Provider declined the refund');

    const refundId = prefixedId('rf');
    const newRefunded = alreadyRefunded.plus(refundAmount);
    const fullyRefunded = newRefunded.greaterThanOrEqualTo(total);

    // Optimistic-locked increment: only succeeds if refundedAmount is unchanged,
    // which prevents concurrent over-refunding. The idempotency record is
    // reserved in the SAME transaction (via its unique constraint) so a
    // *sequential* retry with the same key can't slip past the top-of-method
    // pre-check and issue a second refund.
    // Reserve the refund + idempotency key atomically via the shared guard. The
    // optimistic-locked updateMany (refundedAmount unchanged) is what stops two
    // concurrent refunds from over-refunding: the loser matches 0 rows and its
    // tx aborts. The provider refund is issued above, outside the tx.
    const { resource, replayed } = await this.idempotency.execute<RefundResource>({
      scopeId: ctx.storeId,
      endpoint,
      key: idempotencyKey,
      rawBody,
      run: async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: paymentId, refundedAmount: alreadyRefunded },
          data: { refundedAmount: newRefunded },
        });
        if (updated.count !== 1) {
          throw ApiError.idempotencyConflict('Concurrent refund detected; retry');
        }
        const created = await tx.refund.create({
          data: {
            id: refundId,
            paymentId,
            amount: refundAmount,
            currency: payment.currency,
            reason: dto.reason ?? null,
            status: 'SUCCEEDED',
            providerRefId: providerResult.providerRefId ?? null,
          },
        });
        await tx.paymentStatusHistory.create({
          data: {
            paymentId,
            fromStatus: 'PAID',
            toStatus: 'PAID',
            reason: `refund ${formatAmount(refundAmount, payment.currency)}${providerResult.manual ? ' (manual settlement)' : ''}`,
          },
        });
        return { resource: this.serializeRefund(created), status: 201 };
      },
    });

    // Everything below is a one-time effect of a genuine refund — a replay must
    // not re-post the ledger, re-transition the payment, or re-audit.
    if (!replayed) {
      // Double-entry ledger: post this refund slice (best-effort, idempotent by refundId).
      try {
        const store = await this.prisma.store.findUnique({ where: { id: payment.storeId }, select: { feeBps: true } });
        await this.ledger.postRefund(payment, refundAmount, store?.feeBps ?? 0, refundId);
      } catch (e) {
        this.logger.warn(`ledger postRefund failed for ${paymentId}: ${e}`);
      }

      // Full refund → transition to refunded (emits payment.refunded). Partial →
      // status stays paid, so emit the refund event directly.
      if (fullyRefunded) {
        await this.transition(paymentId, 'refunded', 'fully refunded');
      } else {
        const refreshed = await this.prisma.payment.findUnique({ where: { id: paymentId } });
        if (refreshed) await this.webhookEvents.emitRefunded(refreshed);
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        action: 'payment.refund',
        entity: `payment:${paymentId}`,
        afterValue: { refund_id: refundId, amount: resource.amount, fully_refunded: fullyRefunded, reason: dto.reason },
      });
      this.logger.log(`refund ${refundId} ${resource.amount} ${resource.currency} for ${paymentId}`);
    }
    return { resource, status: 201 };
  }

  async listRefunds(ctx: ApiKeyContext, paymentId: string): Promise<RefundResource[]> {
    await this.findScoped(ctx.storeId, paymentId);
    const refunds = await this.prisma.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
    return refunds.map((r) => this.serializeRefund(r));
  }

  private serializeRefund(r: Refund): RefundResource {
    return {
      id: r.id,
      payment_id: r.paymentId,
      amount: formatAmount(r.amount, r.currency),
      currency: r.currency,
      reason: r.reason,
      status: r.status.toLowerCase() as RefundResource['status'],
      created_at: r.createdAt.toISOString(),
    };
  }

  // ------------------------------------------------------------ simulate (test)
  /** Test-mode-only status simulation, backing the "run a test payment" flow. */
  async simulate(
    ctx: ApiKeyContext,
    id: string,
    target: 'scanned' | 'paid' | 'failed' | 'expired',
  ): Promise<PaymentResource> {
    if (ctx.mode !== 'test') {
      throw ApiError.forbidden('Payment simulation is only available for test-mode keys');
    }
    const payment = await this.findScoped(ctx.storeId, id);
    const current = toApiStatus(payment.status);
    if (!canTransition(current, target)) {
      throw ApiError.invalidRequest(`Cannot move payment from "${current}" to "${target}"`);
    }
    const updated = await this.transition(payment.id, target, `simulated -> ${target}`);
    return this.serialize(updated);
  }

  // ---------------------------------------------------- public checkout view
  /** Safe, secret-free projection for the hosted checkout page. */
  async publicView(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { store: { include: { branding: true } } },
    });
    if (!payment) throw ApiError.paymentNotFound();
    const refreshed = await this.applyLazyExpiry(payment);
    const b = payment.store.branding;
    // Who the payer is actually paying (owner + bank), from the merchant's
    // imported KHQR. Null when the store pays via mock/no imported account.
    const payee = await this.khqr
      .payeeFor(payment.storeId, refreshed.currency as 'USD' | 'KHR', payment.mode === 'LIVE' ? 'live' : 'test')
      .catch(() => null);
    return {
      id: refreshed.id,
      status: toApiStatus(refreshed.status),
      amount: formatAmount(refreshed.amount, refreshed.currency),
      currency: refreshed.currency,
      reference_id: refreshed.referenceId,
      description: refreshed.description,
      qr_string: refreshed.qrString,
      payee,
      // A customer attached to this payment can reach their loyalty wallet from
      // the receipt. Only when known — an anonymous QR payment has no wallet.
      wallet_url: payment.customerId ? `${process.env.CHECKOUT_BASE_URL ?? ''}/wallet/${payment.customerId}` : null,
      created_at: refreshed.createdAt.toISOString(),
      expires_at: refreshed.expiresAt.toISOString(),
      paid_at: refreshed.paidAt?.toISOString() ?? null,
      merchant: {
        name: b?.displayName || payment.store.name,
        logo_url: b?.logoUrl ?? null,
        primary_color: b?.primaryColor ?? '#4F46E5',
        support_email: b?.supportEmail ?? null,
        custom_message: b?.customMessage ?? null,
        success_url: b?.successUrl ?? null,
        failure_url: b?.failureUrl ?? null,
      },
    };
  }

  // --------------------------------------------------------- state transition
  /**
   * Central state-machine transition. Rejects illegal transitions, records
   * history, sets paidAt, and publishes a live event. This is the single place
   * that mutates payment.status.
   */
  async transition(
    paymentId: string,
    to: PaymentStatus,
    reason: string,
  ): Promise<Payment> {
    let emit = true;
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw ApiError.paymentNotFound();
      const from = toApiStatus(payment.status);
      if (from === to) {
        emit = false; // no-op transition — don't re-emit
        return payment;
      }
      if (!canTransition(from, to)) {
        throw ApiError.invalidRequest(`Illegal transition ${from} -> ${to}`);
      }
      // Guard on the from-state so two concurrent callers (e.g. the status poller
      // and an inbound webhook) can't both win the transition and fire the paid
      // side effects twice. The loser's updateMany matches 0 rows.
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: payment.status },
        data: {
          status: toDbStatus(to),
          paidAt: to === 'paid' ? new Date() : payment.paidAt,
        },
      });
      if (updated.count !== 1) {
        // Another transaction already moved this payment; treat as no-op.
        emit = false;
        return payment;
      }
      await tx.paymentStatusHistory.create({
        data: { paymentId, fromStatus: payment.status, toStatus: toDbStatus(to), reason },
      });
      const refreshed = await tx.payment.findUnique({ where: { id: paymentId } });
      return refreshed ?? payment;
    });

    // Live checkout update (SSE) + webhook fan-out for interesting statuses.
    if (emit) {
      if (to === 'paid') {
        await this.quota.recordPaidForStore(result.storeId);
        await this.loyalty.awardForPayment(result); // earn loyalty points
        await this.referrals.onPaidPayment(result); // reward pending referral
        await this.referrals.accrueCommission(result); // affiliate commission
        await this.games.issueForPayment(result); // auto-issue scratch cards
        await this.risk.scorePayment(result); // fraud/risk scoring
        await this.receipts.onPaid(result); // email the payer a receipt
        // Double-entry ledger: post the captured payment (best-effort).
        try {
          const store = await this.prisma.store.findUnique({ where: { id: result.storeId }, select: { feeBps: true } });
          await this.ledger.postPaymentCaptured(result, store?.feeBps ?? 0);
        } catch (e) {
          this.logger.warn(`ledger postPaymentCaptured failed for ${result.id}: ${e}`);
        }
      }
      this.events.publish({ paymentId, status: to, at: new Date().toISOString() });
      if (STATUS_TO_EVENT[to]) {
        await this.webhookEvents.emitForStatus(result, to);
      }
    }
    return result;
  }

  // ----------------------------------------------------------------- internals
  private async findScoped(storeId: string, id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.storeId !== storeId) {
      throw ApiError.paymentNotFound();
    }
    return payment;
  }

  /** Lazily expire a pending/scanned payment whose expiry has passed. */
  private async applyLazyExpiry(payment: Payment): Promise<Payment> {
    const status = toApiStatus(payment.status);
    if ((status === 'pending' || status === 'scanned') && payment.expiresAt < new Date()) {
      return this.transition(payment.id, 'expired', 'expired (lazy)');
    }
    return payment;
  }

  private hashBody(rawBody: string): string {
    return createHash('sha256').update(rawBody || '{}').digest('hex');
  }

  private serialize(payment: Payment): PaymentResource {
    const checkoutBase = this.config.get<string>('checkoutBaseUrl');
    return {
      id: payment.id,
      status: toApiStatus(payment.status),
      amount: formatAmount(payment.amount, payment.currency),
      currency: payment.currency,
      reference_id: payment.referenceId,
      description: payment.description,
      metadata: (payment.metadata as Record<string, unknown>) ?? {},
      qr_string: payment.qrString,
      checkout_url: `${checkoutBase}/pay/${payment.id}`,
      created_at: payment.createdAt.toISOString(),
      expires_at: payment.expiresAt.toISOString(),
      paid_at: payment.paidAt?.toISOString() ?? null,
      refunded_amount: formatAmount(payment.refundedAmount, payment.currency),
      branch_id: payment.branchId ?? null,
      customer_id: payment.customerId ?? null,
    };
  }
}
