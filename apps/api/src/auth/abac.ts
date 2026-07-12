import { MemberRole } from '@paykh/shared-types';

/**
 * Attribute-Based Access Control (ABAC) — a policy layer that sits ON TOP of the
 * role-based matrix (rbac.ts). RBAC answers "may this role perform this action
 * type at all?"; ABAC answers "given the concrete attributes of the subject,
 * resource, and environment, is THIS action allowed?" — e.g. a high-value refund
 * or a write against a *live* store may demand a higher role or MFA even when the
 * coarse permission is held.
 *
 * Policies are pure and deterministic; deny wins. A request is allowed only if no
 * applicable policy denies it (RBAC having already granted the base permission).
 */

export interface AbacSubject {
  userId: string;
  role: MemberRole | null;
  mfaEnabled: boolean;
}

export interface AbacResource {
  type: 'payment' | 'api_key' | 'store' | 'settlement';
  storeLiveMode?: boolean;
  amount?: number; // in currency units
  currency?: string;
  mode?: 'test' | 'live';
  [key: string]: unknown;
}

export interface AbacEnvironment {
  ip?: string;
  at?: Date;
}

export interface AbacRequest {
  subject: AbacSubject;
  action: string; // e.g. payment:refund, apikey:create
  resource: AbacResource;
  env?: AbacEnvironment;
}

export interface PolicyDecision {
  allow: boolean;
  policy?: string;
  reason?: string;
}

interface Policy {
  id: string;
  description: string;
  /** Only evaluated when this returns true. */
  applies: (r: AbacRequest) => boolean;
  /** Return an explicit deny; return null to allow. */
  deny: (r: AbacRequest) => string | null;
}

/** Refunds at/above this value require an owner. */
export const HIGH_VALUE_REFUND_THRESHOLD = 500;

export const POLICIES: Policy[] = [
  {
    id: 'high-value-refund-requires-owner',
    description: `Refunds ≥ $${HIGH_VALUE_REFUND_THRESHOLD} may only be issued by an organization owner.`,
    applies: (r) => r.action === 'payment:refund' && (r.resource.amount ?? 0) >= HIGH_VALUE_REFUND_THRESHOLD,
    deny: (r) => (r.subject.role === 'owner' ? null : `High-value refund (≥ $${HIGH_VALUE_REFUND_THRESHOLD}) requires the owner role; your role is ${r.subject.role ?? 'none'}.`),
  },
  {
    id: 'live-store-write-excludes-analyst',
    description: 'Analysts have read-only access to live stores; write actions on a live store require owner or developer.',
    applies: (r) => r.resource.storeLiveMode === true && (r.action.endsWith(':write') || r.action === 'payment:refund'),
    deny: (r) => (r.subject.role === 'analyst' || r.subject.role === null ? 'Analysts cannot perform write actions on a live store.' : null),
  },
  {
    id: 'live-api-key-requires-owner',
    description: 'Only an owner may mint live-mode API keys (which can move real money).',
    applies: (r) => r.action === 'apikey:create' && r.resource.mode === 'live',
    deny: (r) => (r.subject.role === 'owner' ? null : 'Creating a live API key requires the owner role.'),
  },
  {
    id: 'high-value-refund-requires-mfa',
    description: `Owners must have MFA enabled to issue a refund ≥ $${HIGH_VALUE_REFUND_THRESHOLD} on a live store.`,
    applies: (r) => r.action === 'payment:refund' && r.resource.storeLiveMode === true && (r.resource.amount ?? 0) >= HIGH_VALUE_REFUND_THRESHOLD,
    deny: (r) => (r.subject.mfaEnabled ? null : 'MFA must be enabled to issue high-value refunds on a live store.'),
  },
];

/** Evaluate all applicable policies. Deny wins; otherwise allow. */
export function evaluate(req: AbacRequest): PolicyDecision {
  for (const p of POLICIES) {
    if (!p.applies(req)) continue;
    const reason = p.deny(req);
    if (reason) return { allow: false, policy: p.id, reason };
  }
  return { allow: true };
}

/** List policies (for the access/permissions UI). */
export function listPolicies() {
  return POLICIES.map((p) => ({ id: p.id, description: p.description }));
}
