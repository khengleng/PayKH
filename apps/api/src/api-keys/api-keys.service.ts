import { Injectable } from '@nestjs/common';
import { generateApiKey, ids } from '@paykh/security';
import { ApiKey, KeyMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requireMembership, requirePermission } from '../auth/rbac';
import { AccessService } from '../access/access.service';
import { CreateApiKeyDto } from './dto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  private async storeOrgId(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw ApiError.paymentNotFound('Store not found');
    return store.organizationId;
  }

  /**
   * Create an API key. The full secret is returned exactly once — only the
   * SHA-256 hash is persisted.
   */
  async create(user: AuthUser, dto: CreateApiKeyDto) {
    const orgId = await this.storeOrgId(dto.storeId);
    requirePermission(user, orgId, 'apikey:write');
    // ABAC: minting a live-mode key (real money) requires the owner role.
    await this.access.enforce(user, orgId, 'apikey:create', { type: 'api_key', mode: dto.mode === 'live' ? 'live' : 'test' });

    const generated = generateApiKey(dto.mode);
    const mode: KeyMode = dto.mode === 'live' ? 'LIVE' : 'TEST';
    const record = await this.prisma.apiKey.create({
      data: {
        id: ids.apiKey(),
        storeId: dto.storeId,
        mode,
        label: dto.label ?? null,
        tokenHash: generated.tokenHash,
        displayPrefix: generated.displayPrefix,
        last4: generated.last4,
        scopes: dto.scopes ?? [],
      },
    });

    return {
      ...this.serialize(record),
      // Shown only once, never retrievable again:
      secret: generated.token,
    };
  }

  async list(user: AuthUser, storeId: string) {
    const orgId = await this.storeOrgId(storeId);
    requirePermission(user, orgId, 'apikey:read');
    const keys = await this.prisma.apiKey.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.serialize(k));
  }

  async revoke(user: AuthUser, keyId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw ApiError.paymentNotFound('API key not found');
    const orgId = await this.storeOrgId(key.storeId);
    requirePermission(user, orgId, 'apikey:write');
    if (key.revokedAt) {
      return this.serialize(key);
    }
    const updated = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    return this.serialize(updated);
  }

  /**
   * Rotate = create a fresh key with the same store/mode/label and revoke the
   * old one. Returns the new key's secret once.
   */
  async rotate(user: AuthUser, keyId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw ApiError.paymentNotFound('API key not found');
    const orgId = await this.storeOrgId(key.storeId);
    requireMembership(user, orgId);
    requirePermission(user, orgId, 'apikey:write');

    const generated = generateApiKey(key.mode === 'LIVE' ? 'live' : 'test');
    const [, created] = await this.prisma.$transaction([
      this.prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.apiKey.create({
        data: {
          id: ids.apiKey(),
          storeId: key.storeId,
          mode: key.mode,
          label: key.label ? `${key.label} (rotated)` : 'rotated',
          tokenHash: generated.tokenHash,
          displayPrefix: generated.displayPrefix,
          last4: generated.last4,
          scopes: key.scopes,
        },
      }),
    ]);
    return { ...this.serialize(created), secret: generated.token, rotated_from: keyId };
  }

  private serialize(k: ApiKey) {
    return {
      id: k.id,
      store_id: k.storeId,
      mode: k.mode.toLowerCase(),
      label: k.label,
      display_prefix: k.displayPrefix,
      last4: k.last4,
      scopes: k.scopes,
      last_used_at: k.lastUsedAt?.toISOString() ?? null,
      revoked: k.revokedAt !== null,
      revoked_at: k.revokedAt?.toISOString() ?? null,
      created_at: k.createdAt.toISOString(),
    };
  }
}
