import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { MemberRole } from '@paykh/shared-types';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './current-user';

const ROLE_MAP: Record<string, MemberRole> = {
  OWNER: 'owner',
  DEVELOPER: 'developer',
  ANALYST: 'analyst',
  PLATFORM_ADMIN: 'platform_admin',
};

/**
 * Authenticates dashboard requests via a Bearer JWT. Loads the user's current
 * memberships from the DB on every request so role/suspension changes take
 * effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw ApiError.unauthorized('Missing Bearer token');
    }
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(match[1]);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { memberships: true },
    });
    if (!user) {
      throw ApiError.unauthorized('User no longer exists');
    }

    const authUser: AuthUser = {
      userId: user.id,
      email: user.email,
      memberships: user.memberships.map((m) => ({
        organizationId: m.organizationId,
        role: ROLE_MAP[m.role] ?? 'analyst',
      })),
    };
    (req as Request & { user: AuthUser }).user = authUser;
    return true;
  }
}
