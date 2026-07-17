import { ValueTxnStatus } from '@paykh/shared-types';

/**
 * The digital-value provider boundary (spec §19).
 *
 * PayKH owns campaign, loyalty and promotion logic; the provider owns wallets,
 * assets, balances and blockchain confirmation. PayKH must never talk to
 * Stellar — or to any provider SDK — outside an implementation of this
 * interface. Business modules depend on the token, not on PayChain internals,
 * so the legacy ledger, a mock, and PayChain are interchangeable and the
 * migration in spec §30 can be staged and rolled back.
 */

/** A value amount. Points are whole units; `assetId` names what is being moved. */
export interface ValueAmount {
  assetId: string;
  /** Decimal string — never a float. Points are integers expressed as "100". */
  amount: string;
}

export interface CreateWalletInput {
  /**
   * PayKH's own id for the wallet holder (a customer id). The provider is
   * expected to treat wallet creation as idempotent on this reference, so this
   * is safe to call on every login.
   */
  customerId: string;
  storeId: string;
}

export interface CreateWalletResult {
  walletId: string;
  /** True when the provider returned an existing wallet rather than creating one. */
  existing: boolean;
  raw?: Record<string, unknown>;
}

export interface GetBalancesInput {
  walletId: string;
}

export interface BalanceResult {
  walletId: string;
  balances: ValueAmount[];
  raw?: Record<string, unknown>;
}

/**
 * Shared shape for every value-moving call.
 *
 * `idempotencyKey` is required, not optional: each of these submits value, and
 * a retry without a key moves it twice. Callers derive the key from the event
 * that caused the movement (a points transaction id), so a retry of the same
 * business event always produces the same key.
 */
interface ValueMovementInput {
  idempotencyKey: string;
  reference: string;
}

export interface IssueValueInput extends ValueMovementInput {
  toWalletId: string;
  value: ValueAmount;
}

export interface TransferValueInput extends ValueMovementInput {
  fromWalletId: string;
  toWalletId: string;
  value: ValueAmount;
}

export interface RedeemValueInput extends ValueMovementInput {
  fromWalletId: string;
  value: ValueAmount;
}

export interface BurnValueInput extends ValueMovementInput {
  fromWalletId: string;
  value: ValueAmount;
}

export interface GetTransactionInput {
  transactionId: string;
}

/**
 * The result of a value movement.
 *
 * `status` is deliberately the same lifecycle the local sub-ledger uses, so a
 * provider response maps onto a PointsTransaction without a second vocabulary.
 * A provider that has accepted but not confirmed a submission returns
 * `processing` — never `confirmed`. Spec §20: a reward is not final, and must
 * not be shown to a customer as final, until confirmation arrives.
 */
export interface ValueTransactionResult {
  transactionId: string;
  status: ValueTxnStatus;
  /** Populated once the movement is confirmed on-chain. */
  confirmedAt?: Date;
  /** Provider-side explanation for a failed / manual_review outcome. */
  detail?: string;
  raw?: Record<string, unknown>;
}

export interface DigitalValueHealth {
  healthy: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface DigitalValueProvider {
  readonly name: string;
  createWallet(input: CreateWalletInput): Promise<CreateWalletResult>;
  getBalances(input: GetBalancesInput): Promise<BalanceResult>;
  issue(input: IssueValueInput): Promise<ValueTransactionResult>;
  transfer(input: TransferValueInput): Promise<ValueTransactionResult>;
  redeem(input: RedeemValueInput): Promise<ValueTransactionResult>;
  burn(input: BurnValueInput): Promise<ValueTransactionResult>;
  getTransaction(input: GetTransactionInput): Promise<ValueTransactionResult>;
  getProviderHealth(): Promise<DigitalValueHealth>;
}

export const DIGITAL_VALUE_PROVIDER = Symbol('DIGITAL_VALUE_PROVIDER');

/**
 * Raised when a provider rejects a value movement. Carries whether a retry is
 * meaningful: a timeout after submission is NOT safely retryable as a new
 * movement (the value may already have moved) — it needs the same idempotency
 * key or a status lookup, which is why `retryable` and `ambiguous` are distinct.
 */
export class DigitalValueError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
    /** True when the movement may or may not have been applied provider-side. */
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'DigitalValueError';
  }
}
