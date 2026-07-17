import { MockDigitalValueProvider } from './mock-digital-value.provider';
import { DigitalValueError } from './digital-value-provider.interface';

const PTS = 'asset_loyalty';
const key = (k: string) => ({ idempotencyKey: k, reference: `ref:${k}` });

describe('MockDigitalValueProvider', () => {
  let p: MockDigitalValueProvider;
  beforeEach(() => {
    p = new MockDigitalValueProvider();
    p.reset();
  });

  const balanceOf = async (walletId: string) =>
    (await p.getBalances({ walletId })).balances.find((b) => b.assetId === PTS)?.amount ?? '0';

  describe('wallets', () => {
    it('is idempotent per customer, so login can create unconditionally', async () => {
      const a = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const b = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      expect(a.existing).toBe(false);
      expect(b.existing).toBe(true);
      expect(b.walletId).toBe(a.walletId);
    });

    it('gives different customers different wallets', async () => {
      const a = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const b = await p.createWallet({ customerId: 'cus_2', storeId: 'st_1' });
      expect(b.walletId).not.toBe(a.walletId);
    });
  });

  describe('issue / redeem', () => {
    it('credits the wallet and reports the balance', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const r = await p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: '100' } });
      expect(r.status).toBe('confirmed');
      expect(await balanceOf(walletId)).toBe('100');
    });

    it('debits on redeem', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      await p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: '100' } });
      await p.redeem({ ...key('k2'), fromWalletId: walletId, value: { assetId: PTS, amount: '30' } });
      expect(await balanceOf(walletId)).toBe('70');
    });

    it('refuses to overdraw', async () => {
      // Shadow mode is only meaningful if the mock can disagree with PayKH.
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      await p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: '10' } });
      await expect(
        p.redeem({ ...key('k2'), fromWalletId: walletId, value: { assetId: PTS, amount: '11' } }),
      ).rejects.toThrow(DigitalValueError);
      expect(await balanceOf(walletId)).toBe('10'); // unchanged
    });

    it('rejects a fractional amount rather than silently rounding points', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      await expect(
        p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: '10.5' } }),
      ).rejects.toThrow(/whole units/);
    });
  });

  describe('idempotency', () => {
    it('replays a repeated key instead of issuing twice', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const a = await p.issue({ ...key('same'), toWalletId: walletId, value: { assetId: PTS, amount: '50' } });
      const b = await p.issue({ ...key('same'), toWalletId: walletId, value: { assetId: PTS, amount: '50' } });
      expect(b.transactionId).toBe(a.transactionId);
      expect(await balanceOf(walletId)).toBe('50'); // NOT 100
    });

    it('rejects a key reused with a different payload (PayChain returns 409 here)', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      await p.issue({ ...key('same'), toWalletId: walletId, value: { assetId: PTS, amount: '50' } });
      await expect(
        p.issue({ ...key('same'), toWalletId: walletId, value: { assetId: PTS, amount: '999' } }),
      ).rejects.toThrow(/different payload/);
      expect(await balanceOf(walletId)).toBe('50');
    });
  });

  describe('transfer', () => {
    it('moves value between wallets, conserving the total', async () => {
      const a = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const b = await p.createWallet({ customerId: 'cus_2', storeId: 'st_1' });
      await p.issue({ ...key('k1'), toWalletId: a.walletId, value: { assetId: PTS, amount: '100' } });
      await p.transfer({ ...key('k2'), fromWalletId: a.walletId, toWalletId: b.walletId, value: { assetId: PTS, amount: '40' } });
      expect(await balanceOf(a.walletId)).toBe('60');
      expect(await balanceOf(b.walletId)).toBe('40');
    });

    it('applies nothing when the sender cannot cover it', async () => {
      // Both legs must fail together — a half-applied transfer would invent value.
      const a = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const b = await p.createWallet({ customerId: 'cus_2', storeId: 'st_1' });
      await p.issue({ ...key('k1'), toWalletId: a.walletId, value: { assetId: PTS, amount: '10' } });
      await expect(
        p.transfer({ ...key('k2'), fromWalletId: a.walletId, toWalletId: b.walletId, value: { assetId: PTS, amount: '50' } }),
      ).rejects.toThrow(/Insufficient/);
      expect(await balanceOf(a.walletId)).toBe('10');
      expect(await balanceOf(b.walletId)).toBe('0');
    });
  });

  describe('transactions', () => {
    it('can look a movement back up by id', async () => {
      const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
      const r = await p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: '5' } });
      const got = await p.getTransaction({ transactionId: r.transactionId });
      expect(got.status).toBe('confirmed');
      expect(got.transactionId).toBe(r.transactionId);
    });

    it('throws on an unknown transaction id', async () => {
      await expect(p.getTransaction({ transactionId: 'dvt_nope' })).rejects.toThrow(/Unknown transaction/);
    });
  });

  it('reports healthy', async () => {
    expect((await p.getProviderHealth()).healthy).toBe(true);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER without drift', async () => {
    // Balances are bigint precisely so large point totals stay exact.
    const { walletId } = await p.createWallet({ customerId: 'cus_1', storeId: 'st_1' });
    const huge = '9007199254740993'; // MAX_SAFE_INTEGER + 2
    await p.issue({ ...key('k1'), toWalletId: walletId, value: { assetId: PTS, amount: huge } });
    expect(await balanceOf(walletId)).toBe(huge);
  });
});
