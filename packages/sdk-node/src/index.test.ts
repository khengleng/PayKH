import { createHmac } from 'crypto';
import { PayKH, verifyWebhook, constructEvent, PayKHError } from './index';

function sign(secret: string, body: string, t: number): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('webhook verification', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.completed' });

  it('verifies a valid signature', () => {
    const t = 1_700_000_000;
    expect(verifyWebhook(body, sign(secret, body, t), secret, 300, t).valid).toBe(true);
  });

  it('rejects tampered body / wrong secret / old timestamp', () => {
    const t = 1_700_000_000;
    expect(verifyWebhook(body + 'x', sign(secret, body, t), secret, 300, t).reason).toBe('signature_mismatch');
    expect(verifyWebhook(body, sign('other', body, t), secret, 300, t).valid).toBe(false);
    expect(verifyWebhook(body, sign(secret, body, t), secret, 300, t + 400).reason).toBe('timestamp_out_of_tolerance');
    expect(verifyWebhook(body, 'garbage', secret).reason).toBe('malformed');
  });

  it('constructEvent throws on bad signature and parses on good', () => {
    const t = Math.floor(Date.now() / 1000);
    expect(() => constructEvent(body, 'garbage', secret)).toThrow(PayKHError);
    expect((constructEvent(body, sign(secret, body, t), secret) as any).id).toBe('evt_1');
  });
});

describe('client', () => {
  it('sends the API key and idempotency key, parses the payment', async () => {
    const calls: any[] = [];
    const fakeFetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 'pay_1', status: 'pending', amount: '1.50' }),
      };
    }) as unknown as typeof fetch;

    const paykh = new PayKH('bk_test_x', { baseUrl: 'https://api.example.com', fetch: fakeFetch });
    const p = await paykh.payments.create({ amount: '1.50', currency: 'USD' }, { idempotencyKey: 'k1' });
    expect(p.id).toBe('pay_1');
    expect(calls[0].url).toBe('https://api.example.com/v1/payments');
    expect(calls[0].init.headers.Authorization).toBe('Bearer bk_test_x');
    expect(calls[0].init.headers['Idempotency-Key']).toBe('k1');
  });

  it('throws PayKHError on API error', async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: 'quota_exceeded', message: 'nope', request_id: 'req_1' }),
    })) as unknown as typeof fetch;
    const paykh = new PayKH('bk_test_x', { fetch: fakeFetch });
    await expect(paykh.payments.create({ amount: '1', currency: 'USD' })).rejects.toMatchObject({
      code: 'quota_exceeded',
      status: 402,
      requestId: 'req_1',
    });
  });
});
