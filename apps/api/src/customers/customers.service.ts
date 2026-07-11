import { Injectable } from '@nestjs/common';
import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Customer, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { ApiKeyContext } from '../auth/api-key.guard';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { ReferralsService } from '../referrals/referrals.service';

export class CreateCustomerDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) external_id?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(40) referral_code?: string;
}

export class SetPreferencesDto {
  @IsObject() preferences!: Record<string, boolean>;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referrals: ReferralsService,
  ) {}

  // ------------------------------------------------------------- public API
  async create(ctx: ApiKeyContext, dto: CreateCustomerDto) {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          id: prefixedId('cus'),
          storeId: ctx.storeId,
          name: dto.name ?? null,
          email: dto.email?.toLowerCase() ?? null,
          phone: dto.phone ?? null,
          externalId: dto.external_id ?? null,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      // Link a referral if a code was supplied (best-effort).
      if (dto.referral_code) {
        await this.referrals.linkReferral(ctx.storeId, customer.id, dto.referral_code);
      }
      return this.serialize(customer);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw ApiError.invalidRequest('A customer with this external_id already exists');
      }
      throw err;
    }
  }

  async retrieve(ctx: ApiKeyContext, id: string) {
    const customer = await this.findScoped(ctx.storeId, id);
    return this.serialize(customer);
  }

  async list(ctx: ApiKeyContext, query: { email?: string; external_id?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(query.limit ?? 20, 100);
    const where: Prisma.CustomerWhereInput = { storeId: ctx.storeId };
    if (query.email) where.email = query.email.toLowerCase();
    if (query.external_id) where.externalId = query.external_id;
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    return {
      object: 'list' as const,
      data: rows.slice(0, limit).map((c) => this.serialize(c)),
      has_more: hasMore,
      next_cursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  /** Validate a customer belongs to the store (for linking to a payment). */
  async resolveForStore(storeId: string, customerId: string): Promise<string> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c || c.storeId !== storeId) throw ApiError.invalidRequest('Unknown customer_id for this store');
    return c.id;
  }

  // -------------------------------------------------------------- dashboard
  async dashboardList(user: AuthUser, storeId: string, search?: string, cursor?: string) {
    await this.assertStoreAccess(user, storeId);
    const where: Prisma.CustomerWhereInput = { storeId };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    const rows = await this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const hasMore = rows.length > 50;
    return { object: 'list' as const, data: rows.slice(0, 50).map((c) => this.serialize(c)), has_more: hasMore, next_cursor: hasMore ? rows[49].id : null };
  }

  /** Customer 360: profile + lifetime aggregates + recent payments. */
  async customer360(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { tier: true } });
    if (!customer) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStoreAccess(user, customer.storeId);

    const [paidAgg, allCount, recent] = await Promise.all([
      this.prisma.payment.aggregate({ where: { customerId, status: 'PAID' }, _sum: { amount: true, refundedAmount: true }, _count: { _all: true } }),
      this.prisma.payment.count({ where: { customerId } }),
      this.prisma.payment.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const paidVolume = paidAgg._sum.amount ?? new Prisma.Decimal(0);
    const refunded = paidAgg._sum.refundedAmount ?? new Prisma.Decimal(0);
    const preferences = await this.currentPreferences(customerId);

    return {
      ...this.serialize(customer),
      preferences,
      tier: customer.tier ? { id: customer.tier.id, name: customer.tier.name, earn_multiplier: customer.tier.earnMultiplier.toString() } : null,
      metrics: {
        total_payments: allCount,
        paid_count: paidAgg._count._all,
        lifetime_value: paidVolume.minus(refunded).toFixed(2),
        paid_volume: paidVolume.toFixed(2),
        refunded_total: refunded.toFixed(2),
        last_payment_at: recent[0]?.createdAt.toISOString() ?? null,
      },
      recent_payments: recent.map((p) => ({
        id: p.id,
        status: p.status.toLowerCase(),
        amount: p.amount.toFixed(2),
        currency: p.currency,
        created_at: p.createdAt.toISOString(),
      })),
    };
  }

  // ------------------------------------------------- preferences & consent
  /** Communication channels a customer can opt in/out of. */
  static readonly CONSENT_CHANNELS = ['email', 'sms', 'whatsapp', 'telegram', 'push', 'marketing'];

  private async currentPreferences(customerId: string): Promise<Record<string, boolean>> {
    const rows = await this.prisma.customerPreference.findMany({ where: { customerId } });
    const byChannel = new Map(rows.map((r) => [r.channel, r.optedIn]));
    // Default opt-in true (merchant sends transactional by default); marketing defaults opt-in too but is the gate campaigns check.
    return Object.fromEntries(CustomersService.CONSENT_CHANNELS.map((ch) => [ch, byChannel.get(ch) ?? true]));
  }

  /** Public (API key) read of a customer's preferences. */
  async getPreferences(storeId: string, customerId: string) {
    const c = await this.findScoped(storeId, customerId);
    return { customer_id: c.id, preferences: await this.currentPreferences(c.id) };
  }

  /** Public (API key) update — upserts prefs and appends an immutable consent log. */
  async setPreferences(storeId: string, customerId: string, prefs: Record<string, boolean>, source: string) {
    const c = await this.findScoped(storeId, customerId);
    await this.applyPreferences(c.id, prefs, source);
    return { customer_id: c.id, preferences: await this.currentPreferences(c.id) };
  }

  /** Dashboard (JWT) update. */
  async setPreferencesDashboard(user: AuthUser, customerId: string, prefs: Record<string, boolean>) {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStoreAccess(user, c.storeId);
    await this.applyPreferences(c.id, prefs, 'dashboard');
    return { customer_id: c.id, preferences: await this.currentPreferences(c.id) };
  }

  private async applyPreferences(customerId: string, prefs: Record<string, boolean>, source: string) {
    const entries = Object.entries(prefs).filter(([ch]) => CustomersService.CONSENT_CHANNELS.includes(ch));
    if (entries.length === 0) throw ApiError.invalidRequest('No valid channels; allowed: ' + CustomersService.CONSENT_CHANNELS.join(', '));
    for (const [channel, optedIn] of entries) {
      await this.prisma.$transaction([
        this.prisma.customerPreference.upsert({
          where: { customerId_channel: { customerId, channel } },
          create: { id: prefixedId('pref'), customerId, channel, optedIn },
          update: { optedIn },
        }),
        this.prisma.consentLog.create({ data: { id: prefixedId('cslog'), customerId, channel, optedIn, source } }),
      ]);
    }
  }

  /** Consent gate used by customer-facing messaging/campaigns. Defaults to opted-in. */
  async hasConsent(customerId: string, channel: string): Promise<boolean> {
    const pref = await this.prisma.customerPreference.findUnique({ where: { customerId_channel: { customerId, channel } } });
    return pref?.optedIn ?? true;
  }

  async consentHistory(user: AuthUser, customerId: string) {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) throw ApiError.paymentNotFound('Customer not found');
    await this.assertStoreAccess(user, c.storeId);
    const logs = await this.prisma.consentLog.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return logs.map((l) => ({ channel: l.channel, opted_in: l.optedIn, source: l.source, at: l.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------- internals
  private async findScoped(storeId: string, id: string): Promise<Customer> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c || c.storeId !== storeId) throw ApiError.paymentNotFound('Customer not found');
    return c;
  }

  private async assertStoreAccess(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, 'payment:read');
    return store;
  }

  private serialize(c: Customer) {
    return {
      id: c.id,
      store_id: c.storeId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      external_id: c.externalId,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      points_balance: c.pointsBalance,
      lifetime_points: c.lifetimePoints,
      tier_id: c.tierId,
      created_at: c.createdAt.toISOString(),
    };
  }
}
