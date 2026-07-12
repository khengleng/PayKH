import { evaluate, HIGH_VALUE_REFUND_THRESHOLD, AbacRequest } from './abac';

const req = (over: Partial<AbacRequest>): AbacRequest => ({
  subject: { userId: 'u1', role: 'owner', mfaEnabled: true },
  action: 'payment:refund',
  resource: { type: 'payment', amount: 10, currency: 'USD', storeLiveMode: false },
  ...over,
});

describe('ABAC policy engine', () => {
  it('allows a small refund for any role', () => {
    expect(evaluate(req({ subject: { userId: 'u', role: 'developer', mfaEnabled: false }, resource: { type: 'payment', amount: 10 } })).allow).toBe(true);
  });

  it('denies a high-value refund for a non-owner', () => {
    const d = evaluate(req({ subject: { userId: 'u', role: 'developer', mfaEnabled: true }, resource: { type: 'payment', amount: HIGH_VALUE_REFUND_THRESHOLD } }));
    expect(d.allow).toBe(false);
    expect(d.policy).toBe('high-value-refund-requires-owner');
  });

  it('allows a high-value refund for an owner (test store, MFA on)', () => {
    expect(evaluate(req({ resource: { type: 'payment', amount: 1000, storeLiveMode: false } })).allow).toBe(true);
  });

  it('denies analysts writing to a live store', () => {
    const d = evaluate(req({ subject: { userId: 'u', role: 'analyst', mfaEnabled: false }, action: 'store:write', resource: { type: 'store', storeLiveMode: true } }));
    expect(d.allow).toBe(false);
    expect(d.policy).toBe('live-store-write-excludes-analyst');
  });

  it('requires MFA for a high-value refund on a live store', () => {
    const d = evaluate(req({ subject: { userId: 'u', role: 'owner', mfaEnabled: false }, resource: { type: 'payment', amount: 1000, storeLiveMode: true } }));
    expect(d.allow).toBe(false);
    expect(d.policy).toBe('high-value-refund-requires-mfa');
  });

  it('allows a high-value live refund when owner + MFA', () => {
    expect(evaluate(req({ resource: { type: 'payment', amount: 1000, storeLiveMode: true } })).allow).toBe(true);
  });

  it('denies a non-owner minting a live API key', () => {
    const d = evaluate(req({ subject: { userId: 'u', role: 'developer', mfaEnabled: true }, action: 'apikey:create', resource: { type: 'api_key', mode: 'live' } }));
    expect(d.allow).toBe(false);
    expect(d.policy).toBe('live-api-key-requires-owner');
  });

  it('allows a developer minting a test API key', () => {
    expect(evaluate(req({ subject: { userId: 'u', role: 'developer', mfaEnabled: false }, action: 'apikey:create', resource: { type: 'api_key', mode: 'test' } })).allow).toBe(true);
  });
});
