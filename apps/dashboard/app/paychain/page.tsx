'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, ShellContext } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Asset { id: string; assetCode: string; assetName: string; assetType: string; status: string }
interface Txn { id: string; type: string; status: string; amount?: string; blockchainHash?: string; createdAt?: string }
interface Webhook { id: string; url: string; events: string[]; status: string }
interface Overview {
  loyalty_asset_id: string;
  enabled: boolean;
  webhook: { connected: boolean; url: string };
  status: { health: boolean; ready: boolean; blockchain: unknown };
  assets: Asset[];
  transactions: Txn[];
  webhooks: Webhook[];
}

interface Check { ok: boolean; status: number | null; detail: string }
interface Diagnostics {
  loyalty_asset_id: string;
  checks: { auth: Check; assetRead: Check; loyaltyAsset: Check; ready: Check; blockchain: Check };
}

// Turns a failed probe into a plain-language next step. The loyalty rail needs
// asset.issue to mint, but that scope can't be tested read-only — so the guidance
// points at the operator when the readable capabilities look starved.
const CHECK_META: Record<keyof Diagnostics['checks'], { label: string; hint: (c: Check) => string }> = {
  auth: { label: 'Authentication', hint: () => 'Check your Client ID / Client secret in Settings → PayChain.' },
  assetRead: {
    label: 'Read assets (asset.read)',
    hint: (c) => (c.status === 403 ? 'Ask your PayChain operator to grant the asset.read scope.' : 'PayChain did not return your assets.'),
  },
  loyaltyAsset: {
    label: 'Loyalty asset resolves',
    hint: (c) =>
      c.status === 404
        ? "Your loyalty asset id is not a real PayChain asset ID. It must be the asset's ID — not its code (e.g. “PKHP”). Adopt an asset below, or ask your operator for the asset ID."
        : 'Set or adopt a loyalty asset below.',
  },
  ready: { label: 'Ready', hint: () => 'PayChain reports not-ready — usually transient on testnet.' },
  blockchain: { label: 'Blockchain', hint: () => 'PayChain blockchain not reachable — usually transient on testnet.' },
};

export default function PayChainConsolePage() {
  return <Shell>{(ctx) => <Content ctx={ctx} />}</Shell>;
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-400'}`} />;
}

function Content({ ctx }: { ctx: ShellContext }) {
  const orgId = ctx.me.organizations[0]?.id;
  const [data, setData] = useState<Overview | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setErr('');
    try {
      setData(await api<Overview>(`/dashboard/orgs/${orgId}/paychain/console`));
      setNotConfigured(false);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/not configured/i.test(msg)) setNotConfigured(true);
      else setErr(msg);
    }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  // --- asset creation ---
  const [assetCode, setAssetCode] = useState('');
  const [assetName, setAssetName] = useState('');
  const createAsset = async () => {
    if (!assetCode.trim() || !assetName.trim()) return;
    setBusy('asset'); setErr('');
    try {
      await api(`/dashboard/orgs/${orgId}/paychain/console/assets`, {
        method: 'POST',
        body: { assetCode: assetCode.trim().toUpperCase(), assetName: assetName.trim(), setAsLoyaltyAsset: !data?.loyalty_asset_id },
      });
      setAssetCode(''); setAssetName('');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };

  // --- diagnostics ---
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const runDiagnose = async () => {
    setBusy('diag'); setErr('');
    try { setDiag(await api<Diagnostics>(`/dashboard/orgs/${orgId}/paychain/console/diagnose`)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };

  // --- webhook register ---
  const act = async (path: string, label: string) => {
    setBusy(label); setErr('');
    try { await api(`/dashboard/orgs/${orgId}/paychain/console/${path}`, { method: 'POST' }); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };
  const adoptAsset = (id: string) => act(`assets/${id}/use`, 'use');
  const activate = (id: string) => act(`assets/${id}/activate`, 'act');
  const connectWh = async () => { setBusy('whc'); setErr(''); try { await api(`/dashboard/orgs/${orgId}/paychain/console/webhooks/connect`, { method: 'POST' }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const disconnectWh = async () => { if (!confirm('Disconnect the PayChain webhook?')) return; setBusy('whd'); try { await api(`/dashboard/orgs/${orgId}/paychain/console/webhooks/disconnect`, { method: 'POST' }); await load(); } finally { setBusy(''); } };
  const setEnabled = async (v: boolean) => { setBusy('flag'); try { await api(`/dashboard/orgs/${orgId}/feature-flags/paychain.enabled`, { method: 'PUT', body: { enabled: v } }); await load(); } finally { setBusy(''); } };

  if (notConfigured) {
    return (
      <>
        <PageTitle title="PayChain" subtitle="The digital-value rail behind loyalty." />
        <Card className="text-sm text-slate-600">
          PayChain isn’t connected for your organization yet. Add your PayChain credentials in{' '}
          <Link href="/settings" className="font-medium text-brand-600 hover:underline">Settings → PayChain</Link>, then this console lets you manage assets, transactions and webhooks.
        </Card>
      </>
    );
  }

  return (
    <>
      <PageTitle title="PayChain Console" subtitle="Every PayChain service — assets, on-chain transactions, webhooks — for your loyalty rail." action={<Button variant="secondary" onClick={load}>Refresh</Button>} />
      {err && <Card className="mb-4 text-sm text-red-600">{err}</Card>}
      {!data ? (
        <Card className="text-slate-400">Loading console…</Card>
      ) : (
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">Connection</h3>
              <label className="flex items-center gap-2 text-sm">
                <span className={data.enabled ? 'text-emerald-600' : 'text-slate-500'}>{data.enabled ? 'PayChain earning ON' : 'PayChain earning off'}</span>
                <button
                  type="button" role="switch" aria-checked={data.enabled}
                  onClick={() => setEnabled(!data.enabled)}
                  disabled={busy === 'flag' || !data.loyalty_asset_id}
                  title={!data.loyalty_asset_id ? 'Set a loyalty asset first' : ''}
                  className={`relative h-6 w-11 rounded-full transition ${data.enabled ? 'bg-brand-500' : 'bg-slate-200'} disabled:opacity-50`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${data.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </label>
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <span className="flex items-center gap-2"><Dot ok={data.status.health} /> API health</span>
              <span className="flex items-center gap-2"><Dot ok={data.status.ready} /> Ready</span>
              <span className="flex items-center gap-2"><Dot ok={!!data.status.blockchain} /> Blockchain</span>
              <span className="text-slate-500">Loyalty asset: <span className="font-mono text-slate-700">{data.loyalty_asset_id || 'none — create one below'}</span></span>
            </div>
          </Card>

          {/* Diagnostics — surfaces what a swallowed empty list hides */}
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Connection diagnostics</h3>
                <p className="text-sm text-slate-500">Read-only checks of every capability points-on-chain needs. Run this if earning isn’t showing up on PayChain.</p>
              </div>
              <Button variant="secondary" onClick={runDiagnose} disabled={busy === 'diag'}>{busy === 'diag' ? 'Checking…' : 'Run diagnostics'}</Button>
            </div>
            {diag && (
              <ul className="divide-y divide-slate-100 text-sm">
                {(Object.keys(CHECK_META) as (keyof Diagnostics['checks'])[]).map((k) => {
                  const c = diag.checks[k];
                  const meta = CHECK_META[k];
                  return (
                    <li key={k} className="flex items-start gap-3 py-2">
                      <span className="mt-1"><Dot ok={c.ok} /></span>
                      <span className="min-w-0">
                        <span className="font-medium text-slate-700">{meta.label}</span>
                        {c.status != null && <span className="ml-2 font-mono text-[11px] text-slate-400">HTTP {c.status}</span>}
                        <span className="block text-slate-500">{c.detail}</span>
                        {!c.ok && <span className="block text-amber-600">→ {meta.hint(c)}</span>}
                      </span>
                    </li>
                  );
                })}
                <li className="pt-2 text-xs text-slate-400">Note: minting also requires the <span className="font-mono">asset.issue</span> scope, which can’t be tested read-only. If every check above is green but points still don’t mint, ask your PayChain operator to confirm <span className="font-mono">asset.issue</span> is granted for this client.</li>
              </ul>
            )}
          </Card>

          {/* Assets */}
          <Card>
            <h3 className="mb-1 font-semibold">Loyalty assets</h3>
            <p className="mb-3 text-sm text-slate-500">Create your loyalty currency on PayChain, or use an existing one. New assets are activated automatically.</p>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <label className="text-sm"><div className="mb-1 text-slate-600">Code</div><input value={assetCode} onChange={(e) => setAssetCode(e.target.value.toUpperCase().slice(0, 12))} placeholder="PTS" className="w-24 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm" /></label>
              <label className="text-sm"><div className="mb-1 text-slate-600">Name</div><input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="Shop Points" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
              <Button onClick={createAsset} disabled={busy === 'asset' || !assetCode.trim() || !assetName.trim()}>{busy === 'asset' ? 'Creating…' : 'Create asset'}</Button>
            </div>
            {data.assets.length === 0 ? <p className="text-sm text-slate-400">No assets yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.assets.map((a) => {
                  const isActive = a.status?.toUpperCase() === 'ACTIVE';
                  const inUse = a.id === data.loyalty_asset_id;
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0"><span className="font-mono font-medium">{a.assetCode}</span> <span className="text-slate-500">· {a.assetName}</span> {inUse && <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-700">in use</span>}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={isActive ? 'text-emerald-600' : 'text-amber-600'}>{a.status}</span>
                        {!isActive && <button onClick={() => activate(a.id)} disabled={busy === 'act'} className="text-brand-600 hover:underline">Activate</button>}
                        {!inUse && isActive && <button onClick={() => adoptAsset(a.id)} disabled={busy === 'use'} className="text-brand-600 hover:underline">Use</button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Transactions */}
          <Card className="p-0">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Recent on-chain transactions</div>
            {data.transactions.length === 0 ? <p className="p-4 text-sm text-slate-400">No transactions yet — earn some loyalty points and they’ll appear here.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400"><th className="px-4 py-2">Type</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">On-chain</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {data.transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-2">{t.type}</td>
                        <td className="px-4 py-2 tabular-nums">{t.amount ?? '—'}</td>
                        <td className="px-4 py-2"><span className={t.status?.toUpperCase() === 'CONFIRMED' ? 'text-emerald-600' : 'text-amber-600'}>{t.status}</span></td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-400">{t.blockchainHash ? `${t.blockchainHash.slice(0, 12)}…` : 'pending'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Webhooks — one-click connect PayKH's own receiver */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Confirmation webhooks</h3>
                <p className="text-sm text-slate-500">Lets PayKH mark points confirmed on-chain (with the blockchain hash). No URL to copy — one click.</p>
              </div>
              {data.webhook.connected ? (
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-2 text-sm text-emerald-600"><Dot ok /> Connected</span>
                  <Button variant="secondary" onClick={disconnectWh} disabled={busy === 'whd'}>Disconnect</Button>
                </span>
              ) : (
                <Button onClick={connectWh} disabled={busy === 'whc'}>{busy === 'whc' ? 'Connecting…' : 'Connect webhooks'}</Button>
              )}
            </div>
            <div className="mt-2 truncate font-mono text-[11px] text-slate-400">{data.webhook.url}</div>
          </Card>
        </div>
      )}
    </>
  );
}
