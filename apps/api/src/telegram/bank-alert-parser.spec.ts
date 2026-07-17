import { parseBankAlert } from './bank-alert-parser';

describe('parseBankAlert', () => {
  it('reads a common Wing-style KHR alert', () => {
    expect(parseBankAlert('You have received 5,000 KHR from KHENGLENG TRY.')).toEqual({ amount: '5000', currency: 'KHR' });
  });

  it('reads a USD alert with cents', () => {
    expect(parseBankAlert('Payment received: USD 12.50')).toEqual({ amount: '12.5', currency: 'USD' });
  });

  it('reads the ៛ symbol', () => {
    expect(parseBankAlert('ទទួលបាន ៛5000')).toEqual({ amount: '5000', currency: 'KHR' });
  });

  it('reads a $ symbol', () => {
    expect(parseBankAlert('You received $8 payment')).toEqual({ amount: '8', currency: 'USD' });
  });

  it('treats "5000.00" and "5000" as the same amount', () => {
    expect(parseBankAlert('Received 5000.00 KHR')?.amount).toBe('5000');
  });

  describe('refuses rather than guess', () => {
    it('a message that is not about receiving money', () => {
      expect(parseBankAlert('Your OTP is 123456')).toBeNull();
      expect(parseBankAlert('You sent 5000 KHR to a friend')).toBeNull(); // "sent", not received
    });

    it('a message with no currency', () => {
      expect(parseBankAlert('You received 5000 from someone')).toBeNull();
    });

    it('a message naming two currencies', () => {
      expect(parseBankAlert('Received 5000 KHR (about USD 1.25)')).toBeNull();
    });

    it('a message with two different amounts (payment + balance)', () => {
      // "received 5000 KHR, balance 20000 KHR" — we cannot tell which is the payment.
      expect(parseBankAlert('You received 5,000 KHR. New balance: 20,000 KHR')).toBeNull();
    });

    it('but accepts a repeated identical amount', () => {
      expect(parseBankAlert('Received 5000 KHR (5,000 KHR)')).toEqual({ amount: '5000', currency: 'KHR' });
    });

    it('empty / junk text', () => {
      expect(parseBankAlert('')).toBeNull();
      expect(parseBankAlert('hello there')).toBeNull();
    });

    it('an amount of zero', () => {
      expect(parseBankAlert('Received 0 KHR')).toBeNull();
    });
  });
});
