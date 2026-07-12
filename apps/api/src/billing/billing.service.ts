import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { QuotaService } from './quota.service';
import { currentPeriodStart, nextPeriodStart } from './period.util';
import { GRACE_DAYS, INVOICE_DUE_DAYS, PLATFORM_STORE_ID } from './billing.constants';
import { PAYMENT_PROVIDER, PaymentProvider } from '../providers/payment-provider.interface';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async overview(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org) throw ApiError.paymentNotFound('Organization not found');
    const usage = await this.quota.snapshot(organizationId);
    return {
      organization_id: org.id,
      status: org.status.toLowerCase(),
      plan: org.plan
        ? { id: org.plan.id, name: org.plan.name, monthly_quota: org.plan.monthlyPaidQuota, price_usd_cents: org.plan.priceUsdCents }
        : null,
      usage,
    };
  }

  async listPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { priceUsdCents: 'asc' } });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      monthly_quota: p.monthlyPaidQuota,
      price_usd_cents: p.priceUsdCents,
    }));
  }

  /**
   * Subscribe to a plan. Free plans activate immediately. Paid plans create an
   * OPEN invoice with a platform KHQR (separate ledger from merchant customer
   * payments) — the plan activates only once that invoice is paid.
   */
  async subscribe(user: AuthUser, organizationId: string, planId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw ApiError.invalidRequest('Unknown plan');

    if (plan.priceUsdCents === 0) {
      await this.activatePlan(organizationId, planId, null);
      return { activated: true, ...(await this.overview(user, organizationId)) };
    }

    const invoice = await this.createOpenInvoice(organizationId, plan.id, plan.priceUsdCents);
    return {
      activated: false,
      invoice: {
        id: invoice.id,
        amount_usd_cents: invoice.amountUsdCents,
        status: invoice.status,
        due_at: invoice.dueAt?.toISOString() ?? null,
        qr_string: invoice.qrString,
      },
      message: 'Scan the KHQR to pay. Your plan activates once payment is confirmed.',
    };
  }

  /** Create an OPEN subscription invoice + platform KHQR for a paid plan. */
  private async createOpenInvoice(organizationId: string, planId: string, amountUsdCents: number) {
    const periodStart = currentPeriodStart();
    const periodEnd = nextPeriodStart();
    const dueAt = new Date(Date.now() + INVOICE_DUE_DAYS * 24 * 3600 * 1000);
    const invoice = await this.prisma.invoice.create({
      data: { organizationId, planId, amountUsdCents, status: 'open', periodStart, periodEnd, dueAt },
    });

    try {
      const result = await this.provider.createKhqr({
        paymentId: invoice.id,
        storeId: PLATFORM_STORE_ID,
        mode: 'live',
        amount: (amountUsdCents / 100).toFixed(2),
        currency: 'USD',
        referenceId: invoice.id,
        description: 'PayKH subscription',
        merchantName: 'PayKH',
        merchantCity: 'Phnom Penh',
        expiresAt: dueAt,
      });
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { qrString: result.qrString, md5: result.md5 },
      });
    } catch (err) {
      this.logger.error(`Failed to generate subscription KHQR for invoice ${invoice.id}: ${err}`);
      throw ApiError.providerError('Failed to generate subscription payment QR');
    }
  }

  /** Mark an invoice paid and activate/renew the plan (idempotent). */
  async activateFromInvoice(invoiceId: string): Promise<boolean> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === 'paid' || !invoice.planId) return false;
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paidAt: new Date() },
    });
    await this.activatePlan(invoice.organizationId, invoice.planId, invoice.periodEnd);
    // Recognize subscription revenue in the double-entry ledger (idempotent).
    await this.ledger.postSubscriptionCollected(invoice.id, 'USD', new Prisma.Decimal(invoice.amountUsdCents).div(100));
    this.logger.log(`invoice ${invoiceId} paid -> plan ${invoice.planId} activated for ${invoice.organizationId}`);
    return true;
  }

  /** Set the org's plan, (re)issue the active subscription, clear suspension. */
  private async activatePlan(organizationId: string, planId: string, periodEnd: Date | null) {
    const start = currentPeriodStart();
    const end = periodEnd ?? nextPeriodStart();
    await this.prisma.$transaction([
      this.prisma.subscription.updateMany({
        where: { organizationId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        data: { status: 'CANCELLED' },
      }),
      this.prisma.subscription.create({
        data: { organizationId, planId, status: 'ACTIVE', periodStart: start, periodEnd: end },
      }),
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { planId, status: 'ACTIVE', graceUntil: null },
      }),
    ]);
  }

  /** Dev/test only (mock provider): confirm a subscription invoice payment. */
  async simulateInvoicePayment(user: AuthUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw ApiError.paymentNotFound('Invoice not found');
    requirePermission(user, invoice.organizationId, 'billing:manage');
    if (this.provider.name !== 'mock') {
      throw ApiError.forbidden('Simulation is only available with the mock provider');
    }
    const ok = await this.activateFromInvoice(invoiceId);
    return { invoice_id: invoiceId, paid: ok };
  }

  /** Dunning + grace + suspension for overdue subscription invoices. */
  async runDunning(organizationId: string): Promise<void> {
    const now = new Date();
    const overdue = await this.prisma.invoice.findFirst({
      where: { organizationId, status: 'open', dueAt: { lt: now } },
      orderBy: { dueAt: 'asc' },
    });
    if (!overdue) return;

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return;

    if (!org.graceUntil) {
      const graceUntil = new Date((overdue.dueAt ?? now).getTime() + GRACE_DAYS * 24 * 3600 * 1000);
      await this.prisma.$transaction([
        this.prisma.subscription.updateMany({
          where: { organizationId, status: 'ACTIVE' },
          data: { status: 'PAST_DUE' },
        }),
        this.prisma.organization.update({ where: { id: organizationId }, data: { graceUntil } }),
      ]);
      this.logger.warn(`org ${organizationId} past due; grace until ${graceUntil.toISOString()}`);
    } else if (org.graceUntil < now && org.status !== 'SUSPENDED') {
      await this.prisma.organization.update({ where: { id: organizationId }, data: { status: 'SUSPENDED' } });
      this.logger.warn(`org ${organizationId} suspended after grace period`);
    }
  }

  /** Periodic billing sweep (run by the worker): confirm payments, renew, dun. */
  async sweep(): Promise<void> {
    const now = new Date();

    // 1. Confirm open invoices via the real provider (mock is simulate-driven).
    if (this.provider.name !== 'mock') {
      const open = await this.prisma.invoice.findMany({
        where: { status: 'open', md5: { not: null } },
        take: 200,
      });
      for (const inv of open) {
        try {
          const st = await this.provider.checkPaymentStatus({ md5: inv.md5 });
          if (st.state === 'paid') await this.activateFromInvoice(inv.id);
        } catch (err) {
          this.logger.warn(`invoice poll failed for ${inv.id}: ${err}`);
        }
      }
    }

    // 2. Renewals: paid subscriptions past their period end with no open invoice.
    const dueSubs = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', periodEnd: { lt: now } },
      include: { plan: true },
      take: 200,
    });
    for (const sub of dueSubs) {
      if (sub.plan.priceUsdCents <= 0) continue;
      const openCount = await this.prisma.invoice.count({
        where: { organizationId: sub.organizationId, status: 'open' },
      });
      if (openCount === 0) {
        await this.createOpenInvoice(sub.organizationId, sub.planId, sub.plan.priceUsdCents);
      }
    }

    // 3. Dunning / grace / suspension per org with an overdue open invoice.
    const overdue = await this.prisma.invoice.findMany({
      where: { status: 'open', dueAt: { lt: now } },
      distinct: ['organizationId'],
      take: 200,
    });
    for (const inv of overdue) await this.runDunning(inv.organizationId);
  }

  async planHistory(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const subs = await this.prisma.subscription.findMany({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map((s) => ({
      id: s.id,
      plan: s.plan.name,
      status: s.status.toLowerCase(),
      period_start: s.periodStart.toISOString(),
      period_end: s.periodEnd.toISOString(),
      created_at: s.createdAt.toISOString(),
    }));
  }

  async listInvoices(user: AuthUser, organizationId: string) {
    requirePermission(user, organizationId, 'billing:manage');
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map((i) => ({
      id: i.id,
      amount_usd_cents: i.amountUsdCents,
      status: i.status,
      period_start: i.periodStart.toISOString(),
      period_end: i.periodEnd.toISOString(),
      created_at: i.createdAt.toISOString(),
    }));
  }
}
