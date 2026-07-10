import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, Prisma, PaymentStatus as DbStatus } from '@prisma/client';
import { ids } from '@paykh/security';
import {
  canTransition,
  PaymentResource,
  PaymentStatus,
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
import { CreatePaymentDto, ListPaymentsDto } from './dto';
import { PaymentEventsService } from './payment-events.service';

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
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // --------------------------------------------------------------------- create
  async create(
    ctx: ApiKeyContext,
    dto: CreatePaymentDto,
    idempotencyKey: string | undefined,
    rawBody: string,
  ): Promise<{ resource: PaymentResource; status: number }> {
    const endpoint = 'POST /v1/payments';
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

    const amount = validateAmount(dto.amount, dto.currency);
    const store = await this.prisma.store.findUnique({
      where: { id: ctx.storeId },
      include: { branding: true },
    });
    if (!store) throw ApiError.internal('Store missing for API key');

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
        amount: formatAmount(amount, dto.currency),
        currency: dto.currency,
        referenceId: dto.reference_id ?? null,
        description: dto.description ?? null,
        merchantName: store.branding?.displayName || store.name,
        merchantCity: 'Phnom Penh',
        expiresAt,
      });
    } catch (err) {
      this.logger.error(`Provider createKhqr failed for ${paymentId}`, err as Error);
      throw ApiError.providerError('Failed to generate KHQR');
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          id: paymentId,
          storeId: ctx.storeId,
          apiKeyId: ctx.apiKeyId,
          mode: ctx.mode === 'live' ? 'LIVE' : 'TEST',
          status: 'PENDING',
          amount,
          currency: dto.currency,
          referenceId: dto.reference_id ?? null,
          description: dto.description ?? null,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
          qrString: providerResult.qrString,
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
      return created;
    });

    const resource = this.serialize(payment);
    // payment.created event contract (delivery worker lands in Phase 2).
    this.logger.log(`payment.created ${paymentId} amount=${resource.amount} ${resource.currency}`);

    if (idempotencyKey) {
      await this.storeIdempotency(ctx.storeId, endpoint, idempotencyKey, requestHash, 201, resource);
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
    return {
      id: refreshed.id,
      status: toApiStatus(refreshed.status),
      amount: formatAmount(refreshed.amount, refreshed.currency),
      currency: refreshed.currency,
      reference_id: refreshed.referenceId,
      description: refreshed.description,
      qr_string: refreshed.qrString,
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
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw ApiError.paymentNotFound();
      const from = toApiStatus(payment.status);
      if (from === to) return payment;
      if (!canTransition(from, to)) {
        throw ApiError.invalidRequest(`Illegal transition ${from} -> ${to}`);
      }
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: toDbStatus(to),
          paidAt: to === 'paid' ? new Date() : payment.paidAt,
        },
      });
      await tx.paymentStatusHistory.create({
        data: { paymentId, fromStatus: payment.status, toStatus: toDbStatus(to), reason },
      });
      return updated;
    }).then((updated) => {
      const event = STATUS_TO_EVENT[to];
      if (event) {
        // Phase 2: enqueue webhook delivery job here.
        this.logger.log(`${event} ${paymentId}`);
      }
      this.events.publish({ paymentId, status: to, at: new Date().toISOString() });
      return updated;
    });
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

  private async storeIdempotency(
    storeId: string,
    endpoint: string,
    idempotencyKey: string,
    requestHash: string,
    responseStatus: number,
    resource: PaymentResource,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.idempotencyRecord
      .create({
        data: {
          storeId,
          endpoint,
          idempotencyKey,
          requestHash,
          responseStatus,
          responseBody: resource as unknown as Prisma.InputJsonValue,
          expiresAt,
        },
      })
      .catch((err) => {
        // Unique-constraint race: another request stored it first — safe to ignore.
        this.logger.warn(`Idempotency store race for key=${idempotencyKey}: ${err}`);
      });
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
    };
  }
}
