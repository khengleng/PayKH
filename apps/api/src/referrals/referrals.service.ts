import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma, Payment, Referral } from '@prisma/client';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';

export class UpdateReferralProgramDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) referrerPoints?: number;
  @IsOptional() @IsInt() @Min(0) refereePoints?: number;
  /** Affiliate commission in basis points (100 = 1%), capped at 100% (10000). */
  @IsOptional() @IsInt() @Min(0) @Max(10000) commissionBps?: number;
  /** Days after referral during which commission accrues (null/0 = lifetime). */
  @IsOptional() @IsInt() @Min(0) commissionDurationDays?: number;
}

export class PayoutCommissionsDto {
  /** Optional: pay out a single referrer only. Omit to pay all accrued. */
  @IsOptional() @IsString() referrerCustomerId?: string;
  /** Optional external reference (bank transfer id, etc.) recorded on payout. */
  @IsOptional() @IsString() payoutRef?: string;
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger('Referrals');

  constructor(private readonly prisma: PrismaService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'store:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  // ---------------------------------------------------------------- program
  async getProgram(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const p = await this.prisma.referralProgram.findUnique({ where: { storeId } });
    return this.programResponse(storeId, p);
  }

  async updateProgram(user: AuthUser, storeId: string, dto: UpdateReferralProgramDto) {
    await this.assertStore(user, storeId, 'store:write');
    const p = await this.prisma.referralProgram.upsert({
      where: { storeId },
      create: {
        storeId,
        active: dto.active ?? false,
        referrerPoints: dto.referrerPoints ?? 0,
        refereePoints: dto.refereePoints ?? 0,
        commissionBps: dto.commissionBps ?? 0,
        commissionDurationDays: dto.commissionDurationDays || null,
      },
      update: {
        active: dto.active,
        referrerPoints: dto.referrerPoints,
        refereePoints: dto.refereePoints,
        commissionBps: dto.commissionBps,
        // 0 clears the window (lifetime); undefined leaves it unchanged.
        commissionDurationDays: dto.commissionDurationDays === undefined ? undefined : dto.commissionDurationDays || null,
      },
    });
    return this.programResponse(storeId, p);
  }

  private programResponse(storeId: string, p: { active: boolean; referrerPoints: number; refereePoints: number; commissionBps: number; commissionDurationDays: number | null } | null) {
    return {
      store_id: storeId,
      active: p?.active ?? false,
      referrer_points: p?.referrerPoints ?? 0,
      referee_points: p?.refereePoints ?? 0,
      commission_bps: p?.commissionBps ?? 0,
      commission_duration_days: p?.commissionDurationDays ?? null,
    };
  }

  // ------------------------------------------------------------------- code
  /** Get (or lazily generate) a customer's referral code. Called via API key. */
  async getOrCreateCode(storeId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.storeId !== storeId) throw ApiError.paymentNotFound('Customer not found');
    if (customer.referralCode) return this.codeResponse(customer.referralCode);
    // Generate a unique code (retry on the rare collision).
    for (let i = 0; i < 5; i++) {
      const code = `REF-${randomBase58(6).toUpperCase()}`;
      try {
        const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { referralCode: code } });
        return this.codeResponse(updated.referralCode as string);
      } catch {
        /* unique collision — retry */
      }
    }
    throw ApiError.internal('Could not allocate a referral code');
  }

  private codeResponse(code: string) {
    return { referral_code: code, share_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/?ref=${encodeURIComponent(code)}` };
  }

  // --------------------------------------------------------------- linking
  /** Link a newly-created referee to a referrer by code. Best-effort. */
  async linkReferral(storeId: string, refereeId: string, code: string): Promise<void> {
    const program = await this.prisma.referralProgram.findUnique({ where: { storeId } });
    if (!program?.active) return;
    const referrer = await this.prisma.customer.findFirst({ where: { storeId, referralCode: code } });
    if (!referrer || referrer.id === refereeId) return; // unknown code or self-referral
    const existing = await this.prisma.referral.findUnique({ where: { refereeCustomerId: refereeId } });
    if (existing) return; // already referred
    await this.prisma.$transaction([
      this.prisma.referral.create({
        data: { id: prefixedId('ref'), storeId, referrerCustomerId: referrer.id, refereeCustomerId: refereeId, code, status: 'PENDING' },
      }),
      this.prisma.customer.update({ where: { id: refereeId }, data: { referredByCustomerId: referrer.id } }),
    ]);
    this.logger.log(`referral linked: ${referrer.id} -> ${refereeId}`);
  }

  // ---------------------------------------------------- reward on first pay
  /**
   * On a referee's first paid payment, qualify + reward both parties. Called
   * from the paid transition. Idempotent (referral moves to REWARDED once).
   */
  async onPaidPayment(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const referral = await this.prisma.referral.findUnique({ where: { refereeCustomerId: payment.customerId } });
    if (!referral || referral.status === 'REWARDED') return;
    const program = await this.prisma.referralProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active) return;

    const referrerPts = program.referrerPoints;
    const refereePts = program.refereePoints;

    await this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx for idempotency.
      const fresh = await tx.referral.findUnique({ where: { id: referral.id } });
      if (!fresh || fresh.status === 'REWARDED') return;

      if (referrerPts > 0) {
        await tx.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId: payment.storeId, customerId: referral.referrerCustomerId, type: 'EARN', points: referrerPts, reason: 'referral (referrer)' } });
        await tx.customer.update({ where: { id: referral.referrerCustomerId }, data: { pointsBalance: { increment: referrerPts }, lifetimePoints: { increment: referrerPts } } });
      }
      if (refereePts > 0) {
        await tx.pointsTransaction.create({ data: { id: prefixedId('pts'), storeId: payment.storeId, customerId: referral.refereeCustomerId, type: 'EARN', points: refereePts, paymentId: payment.id, reason: 'referral (referee)' } });
        await tx.customer.update({ where: { id: referral.refereeCustomerId }, data: { pointsBalance: { increment: refereePts }, lifetimePoints: { increment: refereePts } } });
      }
      await tx.referral.update({ where: { id: referral.id }, data: { status: 'REWARDED', rewardedAt: new Date(), rewardPointsReferrer: referrerPts, rewardPointsReferee: refereePts } });
    });
    this.logger.log(`referral ${referral.id} rewarded (referrer +${referrerPts}, referee +${refereePts})`);
  }

  // ---------------------------------------------------- commission accrual
  /**
   * Accrue an affiliate commission to the referrer on EVERY paid payment a
   * referee makes (unlike the one-time points reward). Idempotent per payment
   * (unique `paymentId`). Called from the paid transition. Best-effort — never
   * blocks the payment.
   */
  async accrueCommission(payment: Payment): Promise<void> {
    if (!payment.customerId) return;
    const referral = await this.prisma.referral.findUnique({ where: { refereeCustomerId: payment.customerId } });
    if (!referral) return;
    const program = await this.prisma.referralProgram.findUnique({ where: { storeId: payment.storeId } });
    if (!program?.active || program.commissionBps <= 0) return;

    // Commission window: only accrue within commissionDurationDays of the
    // referral (null/0 = lifetime).
    if (program.commissionDurationDays && program.commissionDurationDays > 0) {
      const windowEnd = referral.createdAt.getTime() + program.commissionDurationDays * 86_400_000;
      if (payment.paidAt && payment.paidAt.getTime() > windowEnd) return;
    }

    const amount = new Prisma.Decimal(payment.amount).mul(program.commissionBps).div(10_000);
    if (amount.lte(0)) return;

    try {
      await this.prisma.referralCommission.create({
        data: {
          id: prefixedId('rc'),
          storeId: payment.storeId,
          referralId: referral.id,
          referrerCustomerId: referral.referrerCustomerId,
          paymentId: payment.id,
          amount, // Decimal is stored at 2dp (schema @db.Decimal(18,2))
          currency: payment.currency,
          bps: program.commissionBps,
          status: 'ACCRUED',
        },
      });
      this.logger.log(`commission accrued: referral ${referral.id} +${amount.toFixed(2)} ${payment.currency} on ${payment.id}`);
    } catch (e) {
      // Unique violation on paymentId => already accrued (idempotent replay).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      this.logger.warn(`commission accrual failed for ${payment.id}: ${String(e)}`);
    }
  }

  // ----------------------------------------------------- commission reads
  async listCommissions(user: AuthUser, storeId: string, status?: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const where: Prisma.ReferralCommissionWhereInput = { storeId };
    const s = status?.toUpperCase();
    if (s === 'ACCRUED' || s === 'PAID' || s === 'VOID') where.status = s;
    const rows = await this.prisma.referralCommission.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const nameOf = await this.nameMap(rows.map((r) => r.referrerCustomerId));
    return rows.map((r) => ({
      id: r.id,
      referrer: nameOf.get(r.referrerCustomerId) ?? r.referrerCustomerId,
      referrer_customer_id: r.referrerCustomerId,
      payment_id: r.paymentId,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      bps: r.bps,
      status: r.status.toLowerCase(),
      created_at: r.createdAt.toISOString(),
      paid_at: r.paidAt?.toISOString() ?? null,
      payout_ref: r.payoutRef,
    }));
  }

  /** Per-referrer + per-currency totals of accrued vs. paid commission. */
  async commissionSummary(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const grouped = await this.prisma.referralCommission.groupBy({
      by: ['referrerCustomerId', 'currency', 'status'],
      where: { storeId, status: { in: ['ACCRUED', 'PAID'] } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const nameOf = await this.nameMap(grouped.map((g) => g.referrerCustomerId));
    // Fold (referrer, currency) -> {accrued, paid}.
    const byKey = new Map<string, { referrerCustomerId: string; currency: string; accrued: Prisma.Decimal; paid: Prisma.Decimal; count: number }>();
    for (const g of grouped) {
      const key = `${g.referrerCustomerId}|${g.currency}`;
      const row = byKey.get(key) ?? { referrerCustomerId: g.referrerCustomerId, currency: g.currency, accrued: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), count: 0 };
      const sum = g._sum.amount ?? new Prisma.Decimal(0);
      if (g.status === 'ACCRUED') row.accrued = row.accrued.add(sum);
      else row.paid = row.paid.add(sum);
      row.count += g._count._all;
      byKey.set(key, row);
    }
    return [...byKey.values()].map((r) => ({
      referrer: nameOf.get(r.referrerCustomerId) ?? r.referrerCustomerId,
      referrer_customer_id: r.referrerCustomerId,
      currency: r.currency,
      accrued: r.accrued.toFixed(2),
      paid: r.paid.toFixed(2),
      count: r.count,
    }));
  }

  /** Mark accrued commissions PAID (all, or one referrer). Returns the count/total. */
  async payoutCommissions(user: AuthUser, storeId: string, dto: PayoutCommissionsDto) {
    await this.assertStore(user, storeId, 'store:write');
    const where: Prisma.ReferralCommissionWhereInput = { storeId, status: 'ACCRUED' };
    if (dto.referrerCustomerId) where.referrerCustomerId = dto.referrerCustomerId;
    const pending = await this.prisma.referralCommission.findMany({ where });
    if (pending.length === 0) return { paid_count: 0, totals: [] as { currency: string; amount: string }[] };

    const paidAt = new Date();
    await this.prisma.referralCommission.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'PAID', paidAt, payoutRef: dto.payoutRef ?? null },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const p of pending) totals.set(p.currency, (totals.get(p.currency) ?? new Prisma.Decimal(0)).add(p.amount));
    this.logger.log(`commissions paid: ${pending.length} entries in store ${storeId}`);
    return { paid_count: pending.length, totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })) };
  }

  private async nameMap(customerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(customerIds)];
    if (ids.length === 0) return new Map();
    const customers = await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
    return new Map(customers.map((c) => [c.id, c.name ?? c.email ?? c.id]));
  }

  // ---------------------------------------------------------------- reads
  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.referral.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const nameOf = await this.nameMap(rows.flatMap((r) => [r.referrerCustomerId, r.refereeCustomerId]));
    return rows.map((r) => this.serialize(r, nameOf));
  }

  private serialize(r: Referral, nameOf: Map<string, string>) {
    return {
      id: r.id,
      referrer: nameOf.get(r.referrerCustomerId) ?? r.referrerCustomerId,
      referee: nameOf.get(r.refereeCustomerId) ?? r.refereeCustomerId,
      code: r.code,
      status: r.status.toLowerCase(),
      reward_referrer: r.rewardPointsReferrer,
      reward_referee: r.rewardPointsReferee,
      created_at: r.createdAt.toISOString(),
      rewarded_at: r.rewardedAt?.toISOString() ?? null,
    };
  }
}
