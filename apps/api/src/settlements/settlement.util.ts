import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export interface SettlementAmounts {
  gross: Prisma.Decimal;
  refunds: Prisma.Decimal;
  fee: Prisma.Decimal;
  net: Prisma.Decimal;
}

/**
 * Compute settlement amounts. The fee is charged on the REFUND-NET volume
 * (gross − refunds), not on gross — this matches the ledger, which credits fee
 * on capture and debits a proportional fee back on every refund, so
 * merchant_payable settles to (gross − refunds)·(1 − bps). Charging fee on gross
 * here would make the statement disagree with the books by refunds·bps (and show
 * a merchant as owing fees on fully-refunded volume).
 *
 * fee = (gross − refunds) * feeBps/10000 (4dp); net = (gross − refunds) − fee.
 */
export function computeSettlementAmounts(
  gross: Prisma.Decimal | string | number,
  refunds: Prisma.Decimal | string | number,
  feeBps: number,
): SettlementAmounts {
  const g = new D(gross);
  const r = new D(refunds);
  const netVolume = g.minus(r);
  const fee = netVolume.times(feeBps).dividedBy(10000).toDecimalPlaces(4);
  const net = netVolume.minus(fee);
  return { gross: g, refunds: r, fee, net };
}
