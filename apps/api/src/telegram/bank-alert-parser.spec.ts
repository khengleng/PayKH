import { parseBankAlert } from './bank-alert-parser';

describe('parseBankAlert', () => {
  describe('real-world alerts that also state a balance', () => {
    // The whole point of the parser: genuine alerts append the new balance (and
    // sometimes a fee), so it must pick the received amount, not the balance.
    it('ABA-style: received amount + available balance in KHR', () => {
      expect(
        parseBankAlert('You have received 20,000 KHR from JOHN DOE. Available balance: 1,234,567 KHR. Trx ID: 9f2c1'),
      ).toEqual({ amount: '20000', currency: 'KHR' });
    });

    it('Wing-style: received USD amount + balance', () => {
      expect(
        parseBankAlert('You have received $10.00 from a customer. Your balance is now $250.00.'),
      ).toEqual({ amount: '10', currency: 'USD' });
    });

    it('ACLEDA-style: credited KHR with remaining balance', () => {
      expect(
        parseBankAlert('Your account was credited 5,000 KHR. Remaining balance 8,650,000 KHR.'),
      ).toEqual({ amount: '5000', currency: 'KHR' });
    });

    it('received amount, a fee, and a balance — takes only the payment', () => {
      expect(
        parseBankAlert('Received 100,000 KHR. Fee 500 KHR. Balance: 2,000,000 KHR'),
      ).toEqual({ amount: '100000', currency: 'KHR' });
    });

    it('Khmer riel symbol with a balance line', () => {
      expect(parseBankAlert('ទទួលបាន ៛5000 ។ សមតុល្យ ៛1000000')).toEqual({ amount: '5000', currency: 'KHR' });
    });
  });

  describe('simple alerts (no balance)', () => {
    it('reads a plain received amount', () => {
      expect(parseBankAlert('Received 5,000 KHR')).toEqual({ amount: '5000', currency: 'KHR' });
    });
    it('reads USD stated before the amount', () => {
      // Canonical form trims the trailing zero (12.50 → 12.5); Decimal.equals
      // still matches a 12.50 charge downstream.
      expect(parseBankAlert('Payment received: USD 12.50')).toEqual({ amount: '12.5', currency: 'USD' });
    });
    it('canonicalises trailing-zero decimals', () => {
      expect(parseBankAlert('You have received 5,000.00 KHR from a customer.')).toEqual({ amount: '5000', currency: 'KHR' });
    });
  });

  describe('refuses rather than guesses', () => {
    it('ignores a non-receive message (OTP)', () => {
      expect(parseBankAlert('Your OTP is 123456')).toBeNull();
    });
    it('ignores an outgoing transfer with no receive hint', () => {
      expect(parseBankAlert('You sent 5,000 to JANE. Balance 1,000,000')).toBeNull();
    });
    it('refuses when both currencies appear', () => {
      expect(parseBankAlert('Received 5,000 KHR (USD 1.25 equivalent)')).toBeNull();
    });
    it('refuses when no currency is present', () => {
      expect(parseBankAlert('You have received 5000 from a customer')).toBeNull();
    });
    it('refuses when two different non-balance amounts are both plausible', () => {
      expect(parseBankAlert('Received 5,000 KHR and 3,000 KHR in two payments')).toBeNull();
    });
    it('refuses when every number looks like a balance/fee', () => {
      // "payment" triggers the receive hint but there is no un-labelled amount.
      expect(parseBankAlert('Payment notice. Fee 500 KHR. Balance 1,000,000 KHR')).toBeNull();
    });
  });
});
