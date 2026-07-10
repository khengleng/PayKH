import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string | null;
  storeId?: string | null;
  actorUserId?: string | null;
  action: string;
  entity?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Append-only audit logging. Records are never updated or deleted from the app;
 * the dashboard exposes read-only views only.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          storeId: entry.storeId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entity: entry.entity ?? null,
          beforeValue: (entry.beforeValue ?? undefined) as never,
          afterValue: (entry.afterValue ?? undefined) as never,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (err) {
      // Audit failures must never break the primary operation, but must be loud.
      this.logger.error(`Failed to write audit log for action=${entry.action}`, err as Error);
    }
  }
}
