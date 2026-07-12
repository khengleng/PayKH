import { Injectable } from '@nestjs/common';
import { MemberRole } from '@paykh/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { AuthUser } from '../auth/current-user';
import { requireMembership, roleForOrg, Permission } from '../auth/rbac';
import { AbacRequest, AbacResource, PolicyDecision, evaluate, listPolicies } from '../auth/abac';

const ROLES: MemberRole[] = ['owner', 'developer', 'analyst', 'platform_admin'];
const PERMISSIONS: Permission[] = [
  'store:read', 'store:write', 'apikey:read', 'apikey:write',
  'payment:read', 'payment:write', 'webhook:write', 'branding:write',
  'team:manage', 'billing:manage',
];
// Mirror of rbac.ROLE_PERMISSIONS for presentation (kept in one place there for enforcement).
const ROLE_PERMS: Record<MemberRole, Permission[]> = {
  owner: PERMISSIONS,
  developer: ['store:read', 'apikey:read', 'apikey:write', 'payment:read', 'payment:write', 'webhook:write'],
  analyst: ['store:read', 'payment:read'],
  platform_admin: ['store:read', 'store:write', 'apikey:read', 'payment:read', 'team:manage', 'billing:manage'],
};

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The RBAC role×permission matrix + ABAC policy catalogue (for the UI). */
  async matrix(user: AuthUser, orgId: string) {
    requireMembership(user, orgId);
    return {
      roles: ROLES,
      permissions: PERMISSIONS,
      matrix: Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(PERMISSIONS.map((p) => [p, ROLE_PERMS[r].includes(p)]))])),
      your_role: roleForOrg(user, orgId),
      abac_policies: listPolicies(),
    };
  }

  /**
   * Simulate an ABAC decision for the current user (transparency / "why can't
   * I do X?"). Builds the subject from the user's role + MFA and evaluates the
   * supplied action + resource attributes.
   */
  async check(user: AuthUser, orgId: string, action: string, resource: AbacResource): Promise<PolicyDecision & { role: MemberRole | null }> {
    requireMembership(user, orgId);
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    const role = roleForOrg(user, orgId);
    const req: AbacRequest = { subject: { userId: user.userId, role, mfaEnabled: !!u?.mfaEnabled }, action, resource };
    return { ...evaluate(req), role };
  }

  /**
   * Enforcement helper used by services: runs ABAC after RBAC and throws 403
   * with the policy reason on deny. Loads the subject (role + MFA) for the org.
   */
  async enforce(user: AuthUser, orgId: string, action: string, resource: AbacResource): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    const role = roleForOrg(user, orgId);
    const decision = evaluate({ subject: { userId: user.userId, role, mfaEnabled: !!u?.mfaEnabled }, action, resource });
    if (!decision.allow) throw ApiError.forbidden(decision.reason ?? 'Denied by policy');
  }
}
