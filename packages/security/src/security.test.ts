import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  apiKeyMode,
} from './apiKeys';
import {
  generateWebhookSecret,
  buildSignatureHeader,
  buildSignatureHeaderMulti,
  verifySignature,
  computeSignature,
} from './hmac';
import { encrypt, decrypt, loadEncryptionKey } from './encryption';
import { prefixedId, ids } from './ids';
import { generateTotpSecret, totpCode, verifyTotp, verifyTotpCounter, base32Decode, base32Encode } from './totp';

describe('apiKeys', () => {
  it('generates a live key with the correct prefix and a matching hash', () => {
    const key = generateApiKey('live');
    expect(key.token.startsWith('bk_live_')).toBe(true);
    expect(key.tokenHash).toBe(hashApiKey(key.token));
    expect(verifyApiKey(key.token, key.tokenHash)).toBe(true);
    expect(apiKeyMode(key.token)).toBe('live');
  });

  it('generates test keys and rejects wrong tokens', () => {
    const key = generateApiKey('test');
    expect(key.token.startsWith('bk_test_')).toBe(true);
    expect(verifyApiKey('bk_test_wrong', key.tokenHash)).toBe(false);
    expect(apiKeyMode('bk_test_x')).toBe('test');
    expect(apiKeyMode('nope_x')).toBeNull();
  });

  it('produces distinct keys each time', () => {
    expect(generateApiKey('live').token).not.toBe(generateApiKey('live').token);
  });
});

describe('hmac webhook signing', () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.completed' });

  it('round-trips a valid signature', () => {
    const ts = 1_700_000_000;
    const header = buildSignatureHeader(secret, body, ts);
    const result = verifySignature(secret, body, header, { nowSeconds: ts });
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = 1_700_000_000;
    const header = buildSignatureHeader(secret, body, ts);
    const result = verifySignature(secret, body + 'x', header, { nowSeconds: ts });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects a wrong secret', () => {
    const ts = 1_700_000_000;
    const header = buildSignatureHeader(secret, body, ts);
    const result = verifySignature('whsec_other', body, header, { nowSeconds: ts });
    expect(result.valid).toBe(false);
  });

  it('enforces timestamp tolerance (replay protection)', () => {
    const ts = 1_700_000_000;
    const header = buildSignatureHeader(secret, body, ts);
    const result = verifySignature(secret, body, header, {
      nowSeconds: ts + 6 * 60,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('timestamp_out_of_tolerance');
  });

  it('rejects malformed headers', () => {
    expect(verifySignature(secret, body, 'garbage').valid).toBe(false);
  });

  it('computeSignature is deterministic', () => {
    expect(computeSignature(secret, 1, 'a')).toBe(computeSignature(secret, 1, 'a'));
  });

  it('dual-signs during rotation so either secret verifies', () => {
    const ts = 1_700_000_000;
    const oldSecret = generateWebhookSecret();
    const newSecret = generateWebhookSecret();
    const header = buildSignatureHeaderMulti([newSecret, oldSecret], body, ts);
    // A consumer still on the old secret verifies.
    expect(verifySignature(oldSecret, body, header, { nowSeconds: ts }).valid).toBe(true);
    // A consumer updated to the new secret verifies.
    expect(verifySignature(newSecret, body, header, { nowSeconds: ts }).valid).toBe(true);
    // An unrelated secret still fails.
    expect(verifySignature(generateWebhookSecret(), body, header, { nowSeconds: ts }).valid).toBe(false);
  });
});

describe('encryption AES-256-GCM', () => {
  const key = loadEncryptionKey('a'.repeat(64));

  it('round-trips plaintext', () => {
    const enc = encrypt('super-secret-bakong-token', key);
    expect(enc).not.toContain('super-secret');
    expect(decrypt(enc, key)).toBe('super-secret-bakong-token');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('fails to decrypt with a tampered tag', () => {
    const enc = encrypt('x', key);
    const parts = enc.split(':');
    parts[2] = Buffer.from('00'.repeat(16), 'hex').toString('base64');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
  });

  it('rejects invalid key length', () => {
    expect(() => loadEncryptionKey('abcd')).toThrow();
  });
});

describe('ids', () => {
  it('produces prefixed ids', () => {
    expect(prefixedId('pay')).toMatch(/^pay_[1-9A-HJ-NP-Za-km-z]{24}$/);
    expect(ids.payment()).toMatch(/^pay_/);
    expect(ids.event()).toMatch(/^evt_/);
  });
});

describe('totp', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from('hello world');
    expect(base32Decode(base32Encode(buf)).toString()).toBe('hello world');
  });

  it('verifies its own current code', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it('rejects a wrong code and tolerates ±1 step drift', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    // code from the previous 30s window still valid within window=1
    const prev = totpCode(secret, now - 30_000);
    expect(verifyTotp(secret, prev, now, 1)).toBe(true);
    // two windows back is rejected
    const older = totpCode(secret, now - 90_000);
    expect(verifyTotp(secret, older, now, 1)).toBe(false);
  });

  it('returns the matched step counter for replay tracking', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    // Current code matches the current step counter.
    expect(verifyTotpCounter(secret, totpCode(secret, now), now)).toBe(step);
    // Previous-window code matches the previous step (strictly smaller), so a
    // caller storing the last counter can reject a replay of the same code.
    expect(verifyTotpCounter(secret, totpCode(secret, now - 30_000), now)).toBe(step - 1);
    // A wrong code yields null.
    expect(verifyTotpCounter(secret, '000000', now)).toBeNull();
  });
});
