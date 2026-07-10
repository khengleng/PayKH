import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MemberRole } from '@paykh/shared-types';

export interface Membership {
  organizationId: string;
  role: MemberRole;
}

export interface AuthUser {
  userId: string;
  email: string;
  memberships: Membership[];
}

/** Injects the authenticated dashboard user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);
