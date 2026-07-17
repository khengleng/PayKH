import { Injectable, Logger } from '@nestjs/common';
import { prefixedId } from '@paykh/security';
import {
  BalanceResult,
  BurnValueInput,
  CreateWalletInput,
  CreateWalletResult,
  DigitalValueError,
  DigitalValueHealth,
  DigitalValueProvider,
  GetBalancesInput,
  GetTransactionInput,
  IssueValueInput,
  RedeemValueInput,
  TransferValueInput,
  ValueAmount,
  ValueTransactionResult,
} from './digital-value-provider.interface';

type Movement = { input: { walletId: string; delta: bigint; assetId: string }[]; result: ValueTransactionResult };

/**
 * In-process DigitalValueProvider. The default, exactly as MockKhqrProvider is
 * the default payment provider.
 *
 * It is not a stub returning fixed values — it holds real balances and enforces
 * the same rules PayChain does, because it has two jobs beyond tests:
 *
 *  1. It is what runs until PayChain credentials exist, so every call site is
 *     exercised before the real provider is wired.
 *  2. It is the comparison arm for shadow mode (spec §30 stages 2-4): PayKH
 *     dual-writes here and reconciles, with the legacy ledger authoritative.
 *
 * A mock that always succeeded would make shadow mode meaningless — the point
 * of the exercise is to surface disagreement, so this one rejects overdrafts
 * and duplicate keys the way the real provider will.
 */
@Injectable()
export class MockDigitalValueProvider implements DigitalValueProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockDigitalValue');

  /** walletId -> customerId, so create is idempotent per customer. */
  private walletsByCustomer = new Map<string, string>();
  /** `${walletId}:${assetId}` -> balance. bigint: points are integers and must not drift. */
  private balances = new Map<string, bigint>();
  /** idempotencyKey -> the movement it produced. */
  private byKey = new Map<string, Movement>();
  private byTxnId = new Map<string, ValueTransactionResult>();

  async createWallet(input: CreateWalletInput): Promise<CreateWalletResult> {
    const existing = this.walletsByCustomer.get(input.customerId);
    if (existing) return { walletId: existing, existing: true };
    const walletId = prefixedId('wlt');
    this.walletsByCustomer.set(input.customerId, walletId);
    return { walletId, existing: false };
  }

  async getBalances(input: GetBalancesInput): Promise<BalanceResult> {
    const balances: ValueAmount[] = [];
    for (const [k, v] of this.balances) {
      const [walletId, assetId] = k.split(':');
      if (walletId === input.walletId) balances.push({ assetId, amount: v.toString() });
    }
    return { walletId: input.walletId, balances };
  }

  async issue(input: IssueValueInput): Promise<ValueTransactionResult> {
    return this.move(input.idempotencyKey, input.reference, [
      { walletId: input.toWalletId, assetId: input.value.assetId, delta: this.parse(input.value) },
    ]);
  }

  async transfer(input: TransferValueInput): Promise<ValueTransactionResult> {
    const amount = this.parse(input.value);
    return this.move(input.idempotencyKey, input.reference, [
      { walletId: input.fromWalletId, assetId: input.value.assetId, delta: -amount },
      { walletId: input.toWalletId, assetId: input.value.assetId, delta: amount },
    ]);
  }

  async redeem(input: RedeemValueInput): Promise<ValueTransactionResult> {
    return this.move(input.idempotencyKey, input.reference, [
      { walletId: input.fromWalletId, assetId: input.value.assetId, delta: -this.parse(input.value) },
    ]);
  }

  async burn(input: BurnValueInput): Promise<ValueTransactionResult> {
    return this.move(input.idempotencyKey, input.reference, [
      { walletId: input.fromWalletId, assetId: input.value.assetId, delta: -this.parse(input.value) },
    ]);
  }

  async getTransaction(input: GetTransactionInput): Promise<ValueTransactionResult> {
    const txn = this.byTxnId.get(input.transactionId);
    if (!txn) throw new DigitalValueError(`Unknown transaction ${input.transactionId}`, 'not_found');
    return txn;
  }

  async getProviderHealth(): Promise<DigitalValueHealth> {
    return { healthy: true, latencyMs: 0, detail: 'in-process mock' };
  }

  /** Test seam: reset state between cases. */
  reset(): void {
    this.walletsByCustomer.clear();
    this.balances.clear();
    this.byKey.clear();
    this.byTxnId.clear();
  }

  private async move(
    idempotencyKey: string,
    reference: string,
    lines: { walletId: string; assetId: string; delta: bigint }[],
  ): Promise<ValueTransactionResult> {
    const prior = this.byKey.get(idempotencyKey);
    if (prior) {
      // Mirrors PayChain: reusing a key with a different payload is a 409, not
      // a silent replay of the wrong movement.
      const same =
        prior.input.length === lines.length &&
        prior.input.every((l, i) => l.walletId === lines[i].walletId && l.assetId === lines[i].assetId && l.delta === lines[i].delta);
      if (!same) {
        throw new DigitalValueError(`Idempotency-Key ${idempotencyKey} reused with a different payload`, 'idempotency_conflict');
      }
      return prior.result;
    }

    for (const l of lines) {
      const next = (this.balances.get(this.key(l.walletId, l.assetId)) ?? 0n) + l.delta;
      if (next < 0n) {
        throw new DigitalValueError(`Insufficient balance in ${l.walletId} for ${l.assetId}`, 'insufficient_balance');
      }
    }
    for (const l of lines) {
      this.balances.set(this.key(l.walletId, l.assetId), (this.balances.get(this.key(l.walletId, l.assetId)) ?? 0n) + l.delta);
    }

    // The mock confirms immediately — it has no chain to wait for. A real
    // provider returns `processing` here and confirms later via webhook, which
    // is why callers must not assume `confirmed` on the response.
    const result: ValueTransactionResult = {
      transactionId: prefixedId('dvt'),
      status: 'confirmed',
      confirmedAt: new Date(),
      raw: { reference, mock: true },
    };
    this.byKey.set(idempotencyKey, { input: lines, result });
    this.byTxnId.set(result.transactionId, result);
    this.logger.debug(`mock value movement ${result.transactionId} (${reference})`);
    return result;
  }

  private key(walletId: string, assetId: string) {
    return `${walletId}:${assetId}`;
  }

  /** Points are integral; a fractional amount is a caller bug, not a rounding case. */
  private parse(v: ValueAmount): bigint {
    if (!/^\d+$/.test(v.amount)) {
      throw new DigitalValueError(`Invalid amount "${v.amount}" for ${v.assetId} (whole units only)`, 'invalid_amount');
    }
    return BigInt(v.amount);
  }
}
