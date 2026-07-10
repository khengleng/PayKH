import { Injectable } from '@nestjs/common';
import { ids } from '@paykh/security';
import { KeyMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requireMembership, requirePermission } from '../auth/rbac';
import { CreateStoreDto, UpdateBrandingDto, UpsertCredentialDto } from './dto';

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Load a store and assert the user is a member of its org. Returns the store. */
  private async loadStoreForUser(user: AuthUser, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { branding: true },
    });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    requireMembership(user, store.organizationId);
    return store;
  }

  async create(user: AuthUser, dto: CreateStoreDto) {
    requirePermission(user, dto.organizationId, 'store:write');
    const store = await this.prisma.store.create({
      data: {
        id: ids.store(),
        organizationId: dto.organizationId,
        name: dto.name,
        branding: { create: {} },
      },
      include: { branding: true },
    });
    return this.serialize(store);
  }

  async list(user: AuthUser) {
    const orgIds = user.memberships.map((m) => m.organizationId);
    const stores = await this.prisma.store.findMany({
      where: { organizationId: { in: orgIds } },
      include: { branding: true },
      orderBy: { createdAt: 'asc' },
    });
    return stores.map((s) => this.serialize(s));
  }

  async get(user: AuthUser, storeId: string) {
    const store = await this.loadStoreForUser(user, storeId);
    return this.serialize(store);
  }

  async updateBranding(user: AuthUser, storeId: string, dto: UpdateBrandingDto) {
    const store = await this.loadStoreForUser(user, storeId);
    requirePermission(user, store.organizationId, 'branding:write');
    const branding = await this.prisma.storeBranding.upsert({
      where: { storeId },
      create: { storeId, ...dto },
      update: { ...dto },
    });
    return branding;
  }

  async upsertCredential(user: AuthUser, storeId: string, dto: UpsertCredentialDto) {
    const store = await this.loadStoreForUser(user, storeId);
    requirePermission(user, store.organizationId, 'store:write');
    const mode: KeyMode = dto.mode === 'live' ? 'LIVE' : 'TEST';
    const secretCiphertext = this.crypto.encrypt(dto.secret);
    await this.prisma.providerCredential.upsert({
      where: { storeId_provider_mode: { storeId, provider: 'bakong', mode } },
      create: { storeId, provider: 'bakong', mode, label: dto.label, secretCiphertext },
      update: { secretCiphertext, label: dto.label },
    });
    // Never return the secret.
    return { storeId, provider: 'bakong', mode: dto.mode, configured: true };
  }

  async setLiveMode(user: AuthUser, storeId: string, liveMode: boolean) {
    const store = await this.loadStoreForUser(user, storeId);
    requirePermission(user, store.organizationId, 'store:write');
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: { liveMode },
      include: { branding: true },
    });
    return this.serialize(updated);
  }

  private serialize(store: {
    id: string;
    organizationId: string;
    name: string;
    liveMode: boolean;
    createdAt: Date;
    branding: {
      displayName: string | null;
      logoUrl: string | null;
      primaryColor: string;
      supportEmail: string | null;
      successUrl: string | null;
      failureUrl: string | null;
      customMessage: string | null;
    } | null;
  }) {
    return {
      id: store.id,
      organization_id: store.organizationId,
      name: store.name,
      live_mode: store.liveMode,
      created_at: store.createdAt.toISOString(),
      branding: store.branding
        ? {
            display_name: store.branding.displayName,
            logo_url: store.branding.logoUrl,
            primary_color: store.branding.primaryColor,
            support_email: store.branding.supportEmail,
            success_url: store.branding.successUrl,
            failure_url: store.branding.failureUrl,
            custom_message: store.branding.customMessage,
          }
        : null,
    };
  }
}
