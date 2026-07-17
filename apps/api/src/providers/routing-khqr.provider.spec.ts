import { RoutingKhqrProvider } from './routing-khqr.provider';
import { CreateKhqrInput } from './payment-provider.interface';

const input = (storeId: string, mode: 'test' | 'live' = 'test'): CreateKhqrInput => ({
  paymentId: 'pay_1', storeId, mode, amount: '5.00', currency: 'USD',
  merchantName: 'Shop', merchantCity: 'Phnom Penh', expiresAt: new Date(0),
});

function make(importedStores: Record<string, 'TEST' | 'LIVE' | undefined>) {
  const prisma = {
    providerCredential: {
      findUnique: jest.fn(({ where }: { where: { storeId_provider_mode: { storeId: string; mode: string } } }) => {
        const w = where.storeId_provider_mode;
        return Promise.resolve(importedStores[w.storeId] === w.mode ? { id: 'cred_1' } : null);
      }),
    },
  };
  const mock = { createKhqr: jest.fn().mockResolvedValue({ qrString: 'MOCK', md5: 'm' }) };
  const bakong = { createKhqr: jest.fn().mockResolvedValue({ qrString: 'BAKONG', md5: 'b' }) };
  const svc = new RoutingKhqrProvider(prisma as never, mock as never, bakong as never);
  return { svc, mock, bakong };
}

describe('RoutingKhqrProvider.createKhqr', () => {
  it('uses the imported bakong account when the store has one', async () => {
    const { svc, mock, bakong } = make({ s1: 'TEST' });
    const r = await svc.createKhqr(input('s1', 'test'));
    expect(r.qrString).toBe('BAKONG');
    expect(bakong.createKhqr).toHaveBeenCalled();
    expect(mock.createKhqr).not.toHaveBeenCalled();
  });

  it('falls back to mock when the store has NOT imported', async () => {
    const { svc, mock, bakong } = make({});
    const r = await svc.createKhqr(input('s2', 'test'));
    expect(r.qrString).toBe('MOCK');
    expect(mock.createKhqr).toHaveBeenCalled();
    expect(bakong.createKhqr).not.toHaveBeenCalled();
  });

  it('matches the credential to the payment mode', async () => {
    // A test-mode import must not route a live payment to the real account.
    const { svc, mock, bakong } = make({ s1: 'TEST' });
    await svc.createKhqr(input('s1', 'live'));
    expect(mock.createKhqr).toHaveBeenCalled();
    expect(bakong.createKhqr).not.toHaveBeenCalled();
  });

  it('routes live payments to a live-mode import', async () => {
    const { svc, bakong } = make({ s1: 'LIVE' });
    await svc.createKhqr(input('s1', 'live'));
    expect(bakong.createKhqr).toHaveBeenCalled();
  });

  it('routes each store independently', async () => {
    const { svc, mock, bakong } = make({ s1: 'TEST' });
    await svc.createKhqr(input('s1', 'test')); // imported → bakong
    await svc.createKhqr(input('s2', 'test')); // not     → mock
    expect(bakong.createKhqr).toHaveBeenCalledTimes(1);
    expect(mock.createKhqr).toHaveBeenCalledTimes(1);
  });
});
