import { Injectable } from '@nestjs/common';
import { IsArray, IsBoolean, IsEmail, IsIn, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { Currency, PaymentLink, PaymentLinkType, Prisma } from '@prisma/client';
import { prefixedId } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requirePermission } from '../auth/rbac';
import { PaymentsService } from '../payments/payments.service';
import { CustomersService } from '../customers/customers.service';

export class CreateLinkDto {
  @IsString() @MaxLength(140) title!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsNumberString() amount?: string; // omit → payer enters amount
  @IsOptional() @IsIn(['USD', 'KHR']) currency?: Currency;
  @IsOptional() @IsIn(['LINK', 'INVOICE']) type?: PaymentLinkType;
  @IsOptional() @IsBoolean() singleUse?: boolean;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsArray() lineItems?: { name: string; qty: number; price: number }[];
}

export class PayLinkDto {
  @IsOptional() @IsNumberString() amount?: string; // required when the link has no fixed amount
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}

@Injectable()
export class LinksService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, private readonly customers: CustomersService) {}

  private async assertStore(user: AuthUser, storeId: string, perm: 'payment:read' | 'payment:write') {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requirePermission(user, store.organizationId, perm);
    return store;
  }

  /** Count of PAID payments minted from a link (via payment metadata). */
  private async paidCount(storeId: string, linkId: string): Promise<number> {
    return this.prisma.payment.count({ where: { storeId, status: 'PAID', metadata: { path: ['payment_link_id'], equals: linkId } } });
  }

  // ------------------------------------------------------------- dashboard
  async create(user: AuthUser, storeId: string, dto: CreateLinkDto) {
    await this.assertStore(user, storeId, 'payment:write');
    const link = await this.prisma.paymentLink.create({
      data: {
        id: prefixedId('plink'),
        storeId,
        type: dto.type ?? 'LINK',
        title: dto.title,
        description: dto.description ?? null,
        amount: dto.amount ?? null,
        currency: dto.currency ?? 'USD',
        singleUse: dto.singleUse ?? (dto.type === 'INVOICE'),
        customerName: dto.customerName ?? null,
        customerEmail: dto.customerEmail?.toLowerCase() ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        lineItems: (dto.lineItems ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    return this.serialize(link);
  }

  async list(user: AuthUser, storeId: string) {
    await this.assertStore(user, storeId, 'payment:read');
    const rows = await this.prisma.paymentLink.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const paid = await Promise.all(rows.map((l) => this.paidCount(storeId, l.id)));
    return rows.map((l, i) => this.serialize(l, paid[i]));
  }

  async setActive(user: AuthUser, linkId: string, active: boolean) {
    const link = await this.prisma.paymentLink.findUnique({ where: { id: linkId } });
    if (!link) throw ApiError.paymentNotFound('Link not found');
    await this.assertStore(user, link.storeId, 'payment:write');
    const updated = await this.prisma.paymentLink.update({ where: { id: linkId }, data: { active } });
    return this.serialize(updated);
  }

  async remove(user: AuthUser, linkId: string) {
    const link = await this.prisma.paymentLink.findUnique({ where: { id: linkId } });
    if (!link) throw ApiError.paymentNotFound('Link not found');
    await this.assertStore(user, link.storeId, 'payment:write');
    await this.prisma.paymentLink.delete({ where: { id: linkId } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------- public
  /** Public link details for the hosted pay-link page (no auth). */
  async publicGet(linkId: string) {
    const link = await this.prisma.paymentLink.findUnique({ where: { id: linkId }, include: { store: { include: { branding: true } } } });
    if (!link) throw ApiError.paymentNotFound('Payment link not found');
    const consumed = link.singleUse && (await this.paidCount(link.storeId, link.id)) > 0;
    return {
      id: link.id,
      type: link.type.toLowerCase(),
      title: link.title,
      description: link.description,
      amount: link.amount?.toFixed(2) ?? null,
      currency: link.currency,
      allows_custom_amount: link.amount === null,
      active: link.active && !consumed,
      store_name: link.store.branding?.displayName ?? link.store.name,
      customer_name: link.customerName,
      due_at: link.dueAt?.toISOString() ?? null,
      line_items: link.lineItems,
      paid: consumed,
    };
  }

  /**
   * Public: mint a Payment for a link and hand back the hosted checkout URL.
   * The link id is the authorization (no API key), mirroring the checkout page.
   */
  async pay(linkId: string, dto: PayLinkDto) {
    const link = await this.prisma.paymentLink.findUnique({ where: { id: linkId }, include: { store: true } });
    if (!link) throw ApiError.paymentNotFound('Payment link not found');
    if (!link.active) throw ApiError.invalidRequest('This payment link is no longer active');
    if (link.singleUse && (await this.paidCount(link.storeId, link.id)) > 0) throw ApiError.invalidRequest('This link has already been paid');

    const amount = link.amount ? link.amount.toFixed(2) : dto.amount;
    if (!amount || Number(amount) <= 0) throw ApiError.invalidRequest('An amount is required');

    const ctx = {
      apiKeyId: '',
      storeId: link.storeId,
      organizationId: link.store.organizationId,
      mode: (link.store.liveMode ? 'live' : 'test') as 'live' | 'test',
    };
    // Attach a customer when the link carries a stable contact (an invoice's
    // email, say) so the payer earns loyalty and gets a wallet on the receipt.
    // A bare payer-typed name has no stable key, so it stays metadata-only.
    const customerId = await this.customers.resolveOrCreateByContact(link.storeId, {
      email: link.customerEmail ?? undefined,
      name: dto.name ?? link.customerName ?? undefined,
    });
    const body = {
      amount,
      currency: link.currency as 'USD' | 'KHR',
      description: link.title,
      metadata: { payment_link_id: link.id, ...(dto.name ? { payer_name: dto.name } : {}), ...(link.customerEmail ? { customer_email: link.customerEmail } : {}) },
      ...(customerId ? { customer_id: customerId } : {}),
    };
    const { resource } = await this.payments.create(ctx, body, undefined, JSON.stringify(body));
    return { payment_id: resource.id, checkout_url: `${process.env.CHECKOUT_BASE_URL ?? ''}/pay/${resource.id}` };
  }

  private serialize(l: PaymentLink, timesPaid = 0) {
    return {
      id: l.id,
      type: l.type.toLowerCase(),
      title: l.title,
      description: l.description,
      amount: l.amount?.toFixed(2) ?? null,
      currency: l.currency,
      active: l.active,
      single_use: l.singleUse,
      times_paid: timesPaid,
      customer_name: l.customerName,
      customer_email: l.customerEmail,
      due_at: l.dueAt?.toISOString() ?? null,
      url: `${process.env.CHECKOUT_BASE_URL ?? ''}/l/${l.id}`,
      created_at: l.createdAt.toISOString(),
    };
  }
}
