import { ConfigService } from '@nestjs/config';
import { BakongKhqrProvider } from './bakong-khqr.provider';
import { buildBakongKhqr, crc16 } from './khqr.util';

function makeProvider(fetchImpl: jest.Mock) {
  const config = {
    get: (k: string) =>
      ({ bakongApiBaseUrl: 'https://api-bakong.test', bakongApiToken: 'tok_123' } as Record<string, string>)[k],
  } as unknown as ConfigService;
  const prisma = {} as never;
  const crypto = {} as never;
  const provider = new BakongKhqrProvider(config, prisma, crypto);
  (global as unknown as { fetch: jest.Mock }).fetch = fetchImpl;
  return provider;
}

describe('BakongKhqrProvider.checkPaymentStatus', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps responseCode 0 to paid', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ responseCode: 0, data: { hash: 'abc123' } }),
    });
    const provider = makeProvider(fetchMock);
    const result = await provider.checkPaymentStatus({ md5: 'deadbeef' });
    expect(result.state).toBe('paid');
    expect(result.providerTxnId).toBe('abc123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-bakong.test/v1/check_transaction_by_md5',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps a non-zero responseCode to pending', async () => {
    const provider = makeProvider(
      jest.fn().mockResolvedValue({ json: async () => ({ responseCode: 1 }) }),
    );
    const result = await provider.checkPaymentStatus({ md5: 'deadbeef' });
    expect(result.state).toBe('pending');
  });

  it('returns unknown without an md5', async () => {
    const provider = makeProvider(jest.fn());
    expect((await provider.checkPaymentStatus({ md5: null })).state).toBe('unknown');
  });
});

describe('buildBakongKhqr', () => {
  it('builds a CRC-valid individual (tag 29) payload', () => {
    const { qrString, md5 } = buildBakongKhqr({
      bakongAccountId: 'shop@bank',
      merchantName: 'Coffee',
      merchantCity: 'Phnom Penh',
      amount: '1.50',
      currency: 'USD',
    });
    expect(qrString.startsWith('000201')).toBe(true);
    expect(qrString).toContain('29'); // individual account tag
    expect(crc16(qrString.slice(0, -4))).toBe(qrString.slice(-4));
    expect(md5).toMatch(/^[0-9a-f]{32}$/);
  });

  it('uses merchant tag 30 with merchant id/bank when isMerchant', () => {
    const { qrString } = buildBakongKhqr({
      bakongAccountId: 'shop@bank',
      merchantName: 'Coffee',
      merchantCity: 'Phnom Penh',
      amount: '2.00',
      currency: 'KHR',
      isMerchant: true,
      merchantId: 'MID123',
      acquiringBank: 'Dev Bank',
    });
    expect(qrString).toContain('MID123');
    expect(qrString).toContain('5303116'); // KHR
  });
});
