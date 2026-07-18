import { MemberRole } from '@paykh/shared-types';
import { ApiError } from '../common/api-error';
import { AuthUser } from './current-user';

/**
 * Least-privilege permission matrix. Phase 1 authorization is role-based via the
 * member's role on an organization (standalone Role/Permission tables are a
 * Phase 3 refinement — see ASSUMPTIONS.md).
 */
export type Permission =
  | 'store:read'
  | 'store:write'
  | 'apikey:read'
  | 'apikey:write'
  | 'payment:read'
  | 'payment:write'
  | 'webhook:write'
  | 'branding:write'
  | 'team:manage'
  | 'billing:manage'
  | 'coupon:read'
  | 'coupon:write'
  | 'giftcard:read'
  | 'giftcard:write'
  | 'paychain:read'
  | 'paychain:write';

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  owner: [
    'store:read',
    'store:write',
    'apikey:read',
    'apikey:write',
    'payment:read',
    'payment:write',
    'webhook:write',
    'branding:write',
    'team:manage',
    'billing:manage',
    'coupon:read',
    'coupon:write',
    'giftcard:read',
    'giftcard:write',
    // PayChain holds value-moving credentials, so it stays with the org owner —
    // deliberately NOT granted to developer/analyst/platform_admin.
    'paychain:read',
    'paychain:write',
  ],
  developer: [
    'store:read',
    'apikey:read',
    'apikey:write',
    'payment:read',
    'payment:write',
    'webhook:write',
    'coupon:read',
    'coupon:write',
    'giftcard:read',
    'giftcard:write',
  ],
  analyst: ['store:read', 'payment:read', 'coupon:read', 'giftcard:read'],
  platform_admin: [
    'store:read',
    'store:write',
    'apikey:read',
    'payment:read',
    'team:manage',
    'billing:manage',
    'coupon:read',
    'giftcard:read',
  ],
};

export function roleForOrg(user: AuthUser, organizationId: string): MemberRole | null {
  return user.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
}

/** Assert the user is a member of the org; returns their role or throws 403. */
export function requireMembership(user: AuthUser, organizationId: string): MemberRole {
  const role = roleForOrg(user, organizationId);
  if (!role) {
    throw ApiError.forbidden('You are not a member of this organization');
  }
  return role;
}

/** Assert the user holds a permission within an org, or throw 403. */
export function requirePermission(
  user: AuthUser,
  organizationId: string,
  permission: Permission,
): void {
  const role = requireMembership(user, organizationId);
  if (!ROLE_PERMISSIONS[role].includes(permission)) {
    throw ApiError.forbidden(`Your role (${role}) cannot perform: ${permission}`);
  }
}
