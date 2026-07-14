import { validateAmount, formatAmount } from './amount.util';
import { ApiError } from '../common/api-error';

describe('validateAmount', () => {
  it('accepts a valid USD amount', () => {
    const v = validateAmount('1.50', 'USD');
    expect(formatAmount(v, 'USD')).toBe('1.50');
  });

  it('rejects an amount below the minimum', () => {
    expect(() => validateAmount('0.001', 'USD')).toThrow(ApiError);
    try {
      validateAmount('0.00', 'USD');
    } catch (e) {
      expect((e as ApiError).code).toBe('amount_too_low');
    }
  });

  it('rejects an amount above the maximum', () => {
    try {
      validateAmount('999999.99', 'USD');
    } catch (e) {
      expect((e as ApiError).code).toBe('amount_too_high');
    }
  });

  it('rejects non-numeric strings', () => {
    expect(() => validateAmount('abc', 'USD')).toThrow(ApiError);
    expect(() => validateAmount('1.5.0', 'USD')).toThrow(ApiError);
    expect(() => validateAmount('-1.50', 'USD')).toThrow(ApiError);
  });

  it('accepts KHR whole amounts and formats them without decimals', () => {
    const v = validateAmount('4000', 'KHR');
    expect(formatAmount(v, 'KHR')).toBe('4000');
  });

  it('rejects fractional KHR amounts', () => {
    try {
      validateAmount('4000.50', 'KHR');
      fail('expected throw');
    } catch (e) {
      expect((e as ApiError).code).toBe('invalid_request');
    }
  });

  it('rejects USD amounts finer than the minor unit', () => {
    try {
      validateAmount('1.005', 'USD');
      fail('expected throw');
    } catch (e) {
      expect((e as ApiError).code).toBe('invalid_request');
    }
  });
});
