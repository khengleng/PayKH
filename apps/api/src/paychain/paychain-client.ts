import { Injectable, Logger } from '@nestjs/common';

/**
 * Direct REST client for PayChain (api.paychain.cambobia.com, /api/v1).
 *
 * We talk to PayChain over plain HTTP rather than its SDK on purpose: the SDK is
 * distributed from a private repo and isn't reachable from a clean CI/Railway
 * build, whereas the REST contract (OpenAPI at /api/v1/openapi.json) is stable
 * and public. Every value-moving call carries an Idempotency-Key derived from
 * the PayKH event that caused it, so a retry of the same business event never
 * moves value twice — PayChain replays the original result.
 *
 * The client is stateless per tenant: each call takes the tenant's resolved
 * connection (base URL + client credentials + loyalty asset). Bearer tokens are
 * cached per (baseUrl, clientId) until shortly before expiry.
 */
export interface PayChainConnection {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  loyaltyAssetId: string;
}

export interface PayChainTxn {
  id: string;
  type: string;
  status: string;
  amount?: string;
  blockchainHash?: string;
  correlationId?: string;
  createdAt?: string;
}

export interface PayChainBalance {
  assetCode: string;
  issuerPublicKey: string;
  balance: string;
  updatedAt?: string;
}

export class PayChainError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = 'PayChainError';
  }
}

const REQUEST_TIMEOUT_MS = 12_000;
const TOKEN_SKEW_MS = 60_000; // refresh a minute before expiry

@Injectable()
export class PayChainClient {
  private readonly logger = new Logger('PayChainClient');
  /** (baseUrl|clientId) -> cached bearer token + expiry epoch ms. */
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  // ------------------------------------------------------------------- auth
  private async token(conn: PayChainConnection): Promise<string> {
    const key = `${conn.baseUrl}|${conn.clientId}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - TOKEN_SKEW_MS > this.now()) return cached.token;

    const body = await this.post<{ access_token: string; expires_in: number }>(
      conn.baseUrl,
      '/oauth/token',
      { grant_type: 'client_credentials', client_id: conn.clientId, client_secret: conn.clientSecret },
      { auth: false },
    );
    if (!body.access_token) throw new PayChainError('PayChain token response missing access_token', 502);
    this.tokens.set(key, { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  // ---------------------------------------------------------------- wallets
  /**
   * Get-or-create the tenant's PayChain wallet for a customer. Idempotent both
   * ways: PayChain treats wallet creation as idempotent on ownerReference, and
   * the Idempotency-Key pins the retry. Returns the wallet id.
   */
  async ensureWallet(conn: PayChainConnection, ownerReference: string, externalReference?: string): Promise<string> {
    const w = await this.post<{ id: string }>(
      conn.baseUrl,
      '/wallets',
      { ownerType: 'CUSTOMER', ownerReference, ...(externalReference ? { externalReference } : {}) },
      { token: await this.token(conn), idempotencyKey: `paykh:wallet:${ownerReference}` },
    );
    if (!w.id) throw new PayChainError('PayChain wallet response missing id', 502);
    return w.id;
  }

  async balances(conn: PayChainConnection, walletId: string): Promise<PayChainBalance[]> {
    const res = await this.get<PayChainBalance[] | { balances: PayChainBalance[] }>(
      conn.baseUrl,
      `/wallets/${encodeURIComponent(walletId)}/balances`,
      await this.token(conn),
    );
    return Array.isArray(res) ? res : (res.balances ?? []);
  }

  // ------------------------------------------------------------ value moves
  /** Mint `amount` of the loyalty asset into a wallet. `eventId` scopes the
   *  Idempotency-Key so re-issuing the same PayKH points txn is a no-op. */
  async issue(conn: PayChainConnection, walletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(
      conn.baseUrl,
      `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/issue`,
      { destinationWalletId: walletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:earn:${eventId}` },
    );
  }

  /** Burn/redeem `amount` of the loyalty asset from a wallet. */
  async redeem(conn: PayChainConnection, walletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(
      conn.baseUrl,
      `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/redeem`,
      { sourceWalletId: walletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:redeem:${eventId}` },
    );
  }

  async health(baseUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.base(baseUrl)}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------- transport
  private base(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, '')}/api/v1`;
  }
  private now(): number {
    // Wrapped so the client stays testable; production uses the real clock.
    return Date.now();
  }

  private async get<T>(baseUrl: string, path: string, token: string): Promise<T> {
    const res = await fetch(`${this.base(baseUrl)}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return this.parse<T>(res, `GET ${path}`);
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    body: unknown,
    opts: { token?: string; auth?: boolean; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const res = await fetch(`${this.base(baseUrl)}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return this.parse<T>(res, `POST ${path}`);
  }

  private async parse<T>(res: Response, label: string): Promise<T> {
    if (res.ok) return (await res.json().catch(() => ({}))) as T;
    // Never surface a raw PayChain body upward — it can echo request fields.
    let detail = `HTTP ${res.status}`;
    try {
      const b = (await res.json()) as { message?: string; error?: string; code?: string };
      detail = b.code || b.error || b.message || detail;
    } catch {
      /* non-JSON error */
    }
    this.logger.warn(`PayChain ${label} failed: ${detail}`);
    throw new PayChainError(`PayChain ${label} failed`, res.status, detail);
  }
}
