import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { hashApiKey, apiKeyMode } from '@paykh/security';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

export interface ApiKeyContext {
  apiKeyId: string;
  storeId: string;
  organizationId: string;
  mode: 'test' | 'live';
}

/**
 * Authenticates public /v1 API requests via `Authorization: Bearer bk_live_…`.
 * Looks the key up by SHA-256 hash (indexed, O(1)), rejects revoked keys, and
 * attaches an ApiKeyContext to the request.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw ApiError.unauthorized('Provide an API key: Authorization: Bearer bk_live_...');
    }
    const token = match[1].trim();
    if (!apiKeyMode(token)) {
      throw ApiError.unauthorized('Malformed API key');
    }

    const tokenHash = hashApiKey(token);
    const key = await this.prisma.apiKey.findUnique({
      where: { tokenHash },
      include: { store: true },
    });
    if (!key || key.revokedAt) {
      throw ApiError.unauthorized('Invalid or revoked API key');
    }

    // Best-effort last-used tracking (throttled to once per minute).
    const now = Date.now();
    if (!key.lastUsedAt || now - key.lastUsedAt.getTime() > 60_000) {
      this.prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    const ctx: ApiKeyContext = {
      apiKeyId: key.id,
      storeId: key.storeId,
      organizationId: key.store.organizationId,
      mode: key.mode === 'LIVE' ? 'live' : 'test',
    };
    (req as Request & { apiKey: ApiKeyContext }).apiKey = ctx;
    return true;
  }
}

/** Extracts the ApiKeyContext attached by ApiKeyGuard. */
export function getApiKeyContext(req: Request): ApiKeyContext {
  const ctx = (req as Request & { apiKey?: ApiKeyContext }).apiKey;
  if (!ctx) throw ApiError.unauthorized();
  return ctx;
}
