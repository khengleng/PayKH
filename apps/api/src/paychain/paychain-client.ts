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

export interface PayChainAsset {
  id: string;
  assetCode: string;
  assetName: string;
  assetType: string;
  status: string;
  issuerPublicKey?: string;
  createdAt?: string;
}

export interface PayChainWebhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  createdAt?: string;
}

export class PayChainError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = 'PayChainError';
  }
}

/** One capability probe from {@link PayChainClient.diagnose}. */
export interface PayChainCheck {
  ok: boolean;
  /** HTTP status when the call reached PayChain; null for transport/local failures. */
  status: number | null;
  detail: string;
}

/** Read-only health of every capability the loyalty rail depends on. */
export interface PayChainDiagnostics {
  auth: PayChainCheck;
  assetRead: PayChainCheck;
  loyaltyAsset: PayChainCheck;
  ready: PayChainCheck;
  blockchain: PayChainCheck;
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
  /**
   * Purchase reward. PayChain's guidance is that a spend-driven loyalty award
   * goes through `earn` — PayChain runs the asset's earn rules against the
   * spend, rather than the caller minting a fixed amount (`issue` is reserved for
   * referrals / games). `eventId` scopes the Idempotency-Key so re-earning the
   * same PayKH points txn is a no-op.
   */
  async earn(
    conn: PayChainConnection,
    walletId: string,
    spendAmount: string,
    currency: string,
    merchantId: string,
    eventId: string,
  ): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(
      conn.baseUrl,
      `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/earn`,
      { walletId, spendAmount, currency, merchantId },
      { token: await this.token(conn), idempotencyKey: `paykh:earn:${eventId}`, correlationId: eventId },
    );
  }

  /** Mint a fixed `amount` into a wallet — for referrals / scratch games. */
  async issue(conn: PayChainConnection, walletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(
      conn.baseUrl,
      `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/issue`,
      { destinationWalletId: walletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:issue:${eventId}`, correlationId: eventId },
    );
  }

  /** Burn/redeem `amount` of the loyalty asset from a wallet. */
  async redeem(conn: PayChainConnection, walletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(
      conn.baseUrl,
      `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/redeem`,
      { sourceWalletId: walletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:redeem:${eventId}`, correlationId: eventId },
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

  /** Deeper status: readiness + blockchain reachability, when authenticated. */
  async status(conn: PayChainConnection): Promise<{ health: boolean; ready: boolean; blockchain: unknown | null }> {
    const token = await this.token(conn).catch(() => null);
    const [ready, blockchain] = await Promise.all([
      token ? this.get<unknown>(conn.baseUrl, '/health/ready', token).then(() => true).catch(() => false) : Promise.resolve(false),
      token ? this.get<unknown>(conn.baseUrl, '/health/blockchain', token).catch(() => null) : Promise.resolve(null),
    ]);
    return { health: await this.health(conn.baseUrl), ready, blockchain };
  }

  /**
   * Non-destructive connection diagnostics. Runs one read-only probe per
   * capability the loyalty rail depends on, reporting the real HTTP status so an
   * owner (or the PayChain operator) can see exactly what's missing — a swallowed
   * empty list hides whether it's "no asset" or "no asset.read scope". No writes,
   * so it's safe to run anytime and to rate-limit loosely.
   */
  async diagnose(conn: PayChainConnection): Promise<PayChainDiagnostics> {
    const auth = await this.check(async () => {
      await this.token(conn);
      return 'Authenticated (client credentials accepted)';
    });
    if (!auth.ok) {
      const skip = (): PayChainCheck => ({ ok: false, status: null, detail: 'Skipped — authentication failed' });
      return { auth, assetRead: skip(), loyaltyAsset: skip(), ready: skip(), blockchain: skip() };
    }
    const token = await this.token(conn);
    const [assetRead, loyaltyAsset, ready, blockchain] = await Promise.all([
      this.check(async () => {
        const a = await this.get<PayChainAsset[]>(conn.baseUrl, '/assets', token);
        const n = Array.isArray(a) ? a.length : 0;
        return `asset.read granted — ${n} asset${n === 1 ? '' : 's'} owned by this client`;
      }),
      conn.loyaltyAssetId
        ? this.check(async () => {
            const a = await this.get<PayChainAsset>(conn.baseUrl, `/assets/${encodeURIComponent(conn.loyaltyAssetId)}`, token);
            return `Resolves to ${a.assetCode} · ${a.status}${a.status === 'ACTIVE' ? '' : ' (must be ACTIVE to earn)'}`;
          })
        : Promise.resolve<PayChainCheck>({ ok: false, status: null, detail: 'No loyalty asset id set' }),
      this.check(async () => {
        await this.get<unknown>(conn.baseUrl, '/health/ready', token);
        return 'Ready';
      }),
      this.check(async () => {
        await this.get<unknown>(conn.baseUrl, '/health/blockchain', token);
        return 'Blockchain reachable';
      }),
    ]);
    return { auth, assetRead, loyaltyAsset, ready, blockchain };
  }

  private async check(fn: () => Promise<string>): Promise<PayChainCheck> {
    try {
      return { ok: true, status: 200, detail: await fn() };
    } catch (e) {
      if (e instanceof PayChainError) return { ok: false, status: e.status, detail: e.detail || e.message };
      return { ok: false, status: null, detail: (e as Error).message };
    }
  }

  // --------------------------------------------------------------- assets
  async listAssets(conn: PayChainConnection): Promise<PayChainAsset[]> {
    return this.get<PayChainAsset[]>(conn.baseUrl, '/assets', await this.token(conn));
  }
  async getAsset(conn: PayChainConnection, assetId: string): Promise<PayChainAsset> {
    return this.get<PayChainAsset>(conn.baseUrl, `/assets/${encodeURIComponent(assetId)}`, await this.token(conn));
  }
  /** Create a loyalty asset (an owner can mint their own loyalty currency from
   *  PayKH rather than pre-provisioning it on PayChain). */
  async createAsset(
    conn: PayChainConnection,
    input: { assetCode: string; assetName: string; assetType?: string; expiryPolicy?: string; expiryDays?: number },
    eventId: string,
  ): Promise<PayChainAsset> {
    return this.post<PayChainAsset>(conn.baseUrl, '/assets', { assetType: 'LOYALTY_POINT', ...input }, {
      token: await this.token(conn),
      idempotencyKey: `paykh:asset:create:${eventId}`,
      correlationId: eventId,
    });
  }
  async activateAsset(conn: PayChainConnection, assetId: string, eventId: string): Promise<PayChainAsset> {
    return this.post<PayChainAsset>(conn.baseUrl, `/assets/${encodeURIComponent(assetId)}/activate`, {}, {
      token: await this.token(conn),
      idempotencyKey: `paykh:asset:activate:${eventId}`,
      correlationId: eventId,
    });
  }

  /** Move points between two customer wallets (P2P gifting). */
  async transfer(conn: PayChainConnection, fromWalletId: string, toWalletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(conn.baseUrl, `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/transfer`,
      { sourceWalletId: fromWalletId, destinationWalletId: toWalletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:transfer:${eventId}`, correlationId: eventId });
  }
  /** Permanently destroy points (e.g. expiry). */
  async burn(conn: PayChainConnection, walletId: string, amount: string, eventId: string): Promise<PayChainTxn> {
    return this.post<PayChainTxn>(conn.baseUrl, `/assets/${encodeURIComponent(conn.loyaltyAssetId)}/burn`,
      { walletId, amount },
      { token: await this.token(conn), idempotencyKey: `paykh:burn:${eventId}`, correlationId: eventId });
  }

  // ---------------------------------------------------------- wallets/txns
  async getWallet(conn: PayChainConnection, walletId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(conn.baseUrl, `/wallets/${encodeURIComponent(walletId)}`, await this.token(conn));
  }
  async listTransactions(conn: PayChainConnection): Promise<PayChainTxn[]> {
    return this.get<PayChainTxn[]>(conn.baseUrl, '/transactions', await this.token(conn));
  }
  async getTransaction(conn: PayChainConnection, txnId: string): Promise<PayChainTxn> {
    return this.get<PayChainTxn>(conn.baseUrl, `/transactions/${encodeURIComponent(txnId)}`, await this.token(conn));
  }

  /** Quote converting points from one asset to another (e.g. redeem loyalty into
   *  a partner asset). Read-only — no idempotency key needed. */
  async conversionQuote(conn: PayChainConnection, input: { fromAssetId: string; toAssetId: string; walletId: string; pointsAmount: string }): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(conn.baseUrl, '/conversions/quote', input, { token: await this.token(conn) });
  }

  // ------------------------------------------------------------- webhooks
  async listWebhooks(conn: PayChainConnection): Promise<PayChainWebhook[]> {
    return this.get<PayChainWebhook[]>(conn.baseUrl, '/webhooks', await this.token(conn));
  }
  /** Register a webhook. The signing secret is returned once, at creation. */
  async createWebhook(conn: PayChainConnection, url: string, events: string[], eventId: string): Promise<PayChainWebhook & { secret?: string; signingSecret?: string }> {
    return this.post<PayChainWebhook & { secret?: string; signingSecret?: string }>(conn.baseUrl, '/webhooks', { url, events }, {
      token: await this.token(conn),
      idempotencyKey: `paykh:webhook:${eventId}`,
      correlationId: eventId,
    });
  }
  async deleteWebhook(conn: PayChainConnection, id: string): Promise<void> {
    await this.del(conn.baseUrl, `/webhooks/${encodeURIComponent(id)}`, await this.token(conn));
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

  private async del(baseUrl: string, path: string, token: string): Promise<void> {
    const res = await fetch(`${this.base(baseUrl)}${path}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 404) await this.parse(res, `DELETE ${path}`);
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    body: unknown,
    opts: { token?: string; auth?: boolean; idempotencyKey?: string; correlationId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    // Optional but recommended by PayChain — echoed through the pipeline + into
    // webhook payloads, so a movement can be traced back to its PayKH event.
    if (opts.correlationId) headers['X-Correlation-Id'] = opts.correlationId;
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
