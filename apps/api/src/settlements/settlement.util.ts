import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export interface SettlementAmounts {
  gross: Prisma.Decimal;
  refunds: Prisma.Decimal;
  fee: Prisma.Decimal;
  net: Prisma.Decimal;
}

/**
 * Compute settlement amounts: fee = gross * feeBps/10000 (4dp), net = gross -
 * refunds - fee. Pure + deterministic for unit testing.
 */
export function computeSettlementAmounts(
  gross: Prisma.Decimal | string | number,
  refunds: Prisma.Decimal | string | number,
  feeBps: number,
): SettlementAmounts {
  const g = new D(gross);
  const r = new D(refunds);
  const fee = g.times(feeBps).dividedBy(10000).toDecimalPlaces(4);
  const net = g.minus(r).minus(fee);
  return { gross: g, refunds: r, fee, net };
}
