import { Injectable, Logger } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma, Payment, Referral } from '@prisma/client';
import * as QRCode from 'qrcode';
import { prefixedId, randomBase58 } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { LedgerService } from '../ledger/ledger.service';

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

export class ReviewReferralDto {
  /** clear = release held commissions; void = cancel them. */
  @IsIn(['clear', 'void']) action!: 'clear' | 'void';
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger('Referrals');

  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

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

  private shareUrl(code: string) {
    return `${process.env.CHECKOUT_BASE_URL ?? ''}/?ref=${encodeURIComponent(code)}`;
  }

  private codeResponse(code: string) {
    return { referral_code: code, share_url: this.shareUrl(code) };
  }

  /**
   * A scannable QR for a customer's referral link. Returns the share URL plus
   * a PNG data URL (easy to `<img src>` or attach) and inline SVG markup.
   * Called via API key; lazily allocates the code if absent.
   */
  async getReferralQr(storeId: string, customerId: string) {
    const { referral_code } = await this.getOrCreateCode(storeId, customerId);
    const url = this.shareUrl(referral_code);
    const [pngDataUrl, svg] = await Promise.all([
      QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 320 }),
      QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }),
    ]);
    return { referral_code, share_url: url, qr_png_data_url: pngDataUrl, qr_svg: svg };
  }

  /** Dashboard (JWT) variant — resolves the customer's store + checks permission. */
  async getReferralQrForDashboard(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStore(user, customer.storeId, 'payment:read');
    return this.getReferralQr(customer.storeId, customerId);
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
    const referee = await this.prisma.customer.findUnique({ where: { id: refereeId } });

    const riskFlags = await this.screenReferral(storeId, referrer, referee);
    const flagged = riskFlags.length > 0;

    await this.prisma.$transaction([
      this.prisma.referral.create({
        data: { id: prefixedId('ref'), storeId, referrerCustomerId: referrer.id, refereeCustomerId: refereeId, code, status: 'PENDING', flagged, riskFlags },
      }),
      this.prisma.customer.update({ where: { id: refereeId }, data: { referredByCustomerId: referrer.id } }),
    ]);
    this.logger.log(`referral linked: ${referrer.id} -> ${refereeId}${flagged ? ` [FLAGGED: ${riskFlags.join(',')}]` : ''}`);
  }

  // --------------------------------------------------------- fraud screening
  private static normEmail(e?: string | null) { return e ? e.trim().toLowerCase() : ''; }
  private static normPhone(p?: string | null) { return p ? p.replace(/\D/g, '') : ''; }
  /** Max referrals a single referrer may create within 24h before being flagged. */
  private static readonly VELOCITY_24H = 10;

  /**
   * Screen a prospective referral for fraud signals, returning risk flags
   * (empty = clean). Checks shared contact details (self-referral via a second
   * account) and referrer velocity. Cheap, synchronous heuristics — no external
   * calls; runs at link time.
   */
  private async screenReferral(
    storeId: string,
    referrer: { id: string; email: string | null; phone: string | null },
    referee: { id: string; email: string | null; phone: string | null } | null,
  ): Promise<string[]> {
    const flags: string[] = [];
    if (referee) {
      const re = ReferralsService.normEmail(referrer.email);
      const ee = ReferralsService.normEmail(referee.email);
      if (re && ee && re === ee) flags.push('shared_email');
      const rp = ReferralsService.normPhone(referrer.phone);
      const ep = ReferralsService.normPhone(referee.phone);
      if (rp && ep && rp === ep) flags.push('shared_phone');
    }
    const since = new Date(Date.now() - 86_400_000);
    const recent = await this.prisma.referral.count({ where: { storeId, referrerCustomerId: referrer.id, createdAt: { gte: since } } });
    if (recent >= ReferralsService.VELOCITY_24H) flags.push('velocity');
    return flags;
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
    if (referral.flagged) return; // held for fraud review — reward once cleared
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

    // Round to 2dp ONCE, up front, so the amount persisted (Decimal(18,2)) and
    // the amount posted to the ledger are identical — otherwise the 4dp accrual
    // credit and the 2dp payout debit leave dust in commission_payable forever.
    const amount = new Prisma.Decimal(payment.amount)
      .mul(program.commissionBps)
      .div(10_000)
      .toDecimalPlaces(2);
    if (amount.lte(0)) return;

    try {
      const commissionId = prefixedId('rc');
      await this.prisma.referralCommission.create({
        data: {
          id: commissionId,
          storeId: payment.storeId,
          referralId: referral.id,
          referrerCustomerId: referral.referrerCustomerId,
          paymentId: payment.id,
          amount, // Decimal is stored at 2dp (schema @db.Decimal(18,2))
          currency: payment.currency,
          bps: program.commissionBps,
          // Flagged referrals accrue as HELD — excluded from payout until review.
          status: referral.flagged ? 'HELD' : 'ACCRUED',
        },
      });
      // Double-entry ledger: accrue the commission liability + expense.
      await this.ledger.postCommissionAccrued(commissionId, payment.storeId, payment.currency, amount);
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
    // Double-entry ledger: post the payout (DR commission payable, CR clearing).
    for (const p of pending) await this.ledger.postCommissionPaid(p.id, p.storeId, p.currency, p.amount);
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
      flagged: r.flagged,
      risk_flags: r.riskFlags,
      reviewed_at: r.reviewedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
      rewarded_at: r.rewardedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------- reports
  /**
   * Referral program analytics: the referral funnel (pending → rewarded),
   * conversion rate, fraud counts, commission totals by status/currency, and
   * a top-referrers leaderboard (successful referrals + commission earned).
   */
  async report(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');

    const [byStatus, flaggedCount, commByStatus, commByReferrer, refByReferrer] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['status'], where: { storeId }, _count: { _all: true } }),
      this.prisma.referral.count({ where: { storeId, flagged: true } }),
      this.prisma.referralCommission.groupBy({ by: ['status', 'currency'], where: { storeId }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.referralCommission.groupBy({ by: ['referrerCustomerId', 'currency'], where: { storeId, status: { in: ['ACCRUED', 'HELD', 'PAID'] } }, _sum: { amount: true } }),
      this.prisma.referral.groupBy({ by: ['referrerCustomerId'], where: { storeId }, _count: { _all: true } }),
    ]);

    const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const total = byStatus.reduce((a, r) => a + r._count._all, 0);
    const rewarded = statusCount('REWARDED');

    // Commission totals by status → { currency: amount }.
    const commission: Record<string, Record<string, string>> = {};
    for (const c of commByStatus) {
      const key = c.status.toLowerCase();
      (commission[key] ??= {})[c.currency] = (c._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
    }

    // Leaderboard: fold successful-referral counts + earned commission per referrer.
    const earned = new Map<string, Map<string, Prisma.Decimal>>();
    for (const c of commByReferrer) {
      const m = earned.get(c.referrerCustomerId) ?? new Map();
      m.set(c.currency, (m.get(c.currency) ?? new Prisma.Decimal(0)).add(c._sum.amount ?? 0));
      earned.set(c.referrerCustomerId, m);
    }
    const referralCounts = new Map(refByReferrer.map((r) => [r.referrerCustomerId, r._count._all]));
    const referrerIds = [...new Set([...earned.keys(), ...referralCounts.keys()])];
    const nameOf = await this.nameMap(referrerIds);
    const topReferrers = referrerIds
      .map((id) => ({
        referrer: nameOf.get(id) ?? id,
        referrer_customer_id: id,
        referrals: referralCounts.get(id) ?? 0,
        commission_earned: [...(earned.get(id)?.entries() ?? [])].map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
      }))
      .sort((a, b) => b.referrals - a.referrals)
      .slice(0, 10);

    return {
      store_id: storeId,
      funnel: {
        total,
        pending: statusCount('PENDING'),
        qualified: statusCount('QUALIFIED'),
        rewarded,
        flagged: flaggedCount,
      },
      conversion_rate: total > 0 ? Number((rewarded / total).toFixed(4)) : 0,
      commission,
      top_referrers: topReferrers,
    };
  }

  // --------------------------------------------------------- fraud review
  /** List referrals flagged by fraud screening and awaiting review. */
  async listFlagged(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.referral.findMany({ where: { storeId, flagged: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const nameOf = await this.nameMap(rows.flatMap((r) => [r.referrerCustomerId, r.refereeCustomerId]));
    return rows.map((r) => this.serialize(r, nameOf));
  }

  /**
   * Resolve a flagged referral. `clear` unflags it and releases any HELD
   * commissions to ACCRUED (payable). `void` cancels its HELD commissions and
   * keeps the referral flagged (rejected). Both stamp reviewedAt.
   */
  async reviewReferral(user: AuthUser, storeId: string, referralId: string, action: 'clear' | 'void') {
    await this.assertStore(user, storeId, 'store:write');
    const referral = await this.prisma.referral.findUnique({ where: { id: referralId } });
    if (!referral || referral.storeId !== storeId) throw ApiError.paymentNotFound('Referral not found');

    const reviewedAt = new Date();
    if (action === 'clear') {
      await this.prisma.$transaction([
        this.prisma.referral.update({ where: { id: referralId }, data: { flagged: false, reviewedAt } }),
        this.prisma.referralCommission.updateMany({ where: { referralId, status: 'HELD' }, data: { status: 'ACCRUED' } }),
      ]);
      this.logger.log(`referral ${referralId} cleared — held commissions released`);
    } else {
      await this.prisma.$transaction([
        this.prisma.referral.update({ where: { id: referralId }, data: { reviewedAt } }),
        this.prisma.referralCommission.updateMany({ where: { referralId, status: 'HELD' }, data: { status: 'VOID' } }),
      ]);
      this.logger.log(`referral ${referralId} voided — held commissions cancelled`);
    }
    const fresh = await this.prisma.referral.findUnique({ where: { id: referralId } });
    const nameOf = await this.nameMap([referral.referrerCustomerId, referral.refereeCustomerId]);
    return this.serialize(fresh as Referral, nameOf);
  }
}
