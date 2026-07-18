'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import { Button, Card, Stat, StatusBadge } from '@/components/ui';
import { LogoMark } from '@/components/Logo';

interface Metrics { organizations: number; suspended: number; stores: number; total_payments: number; paid_count: number; paid_volume: string; success_rate: number }

const TABS = ['Overview', 'Merchants', 'Financials', 'Payouts', 'Ops', 'AI', 'Trustee', 'Settings'] as const;
type Tab = typeof TABS[number];

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [email, setEmail] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');

  useEffect(() => {
    if (!tokenStore.get()) { router.replace('/login?next=/admin'); return; }
    (async () => {
      try {
        const me = await api<{ is_platform_admin: boolean; email: string }>('/admin/me');
        setEmail(me.email);
        if (me.is_platform_admin) setAllowed(true);
      } catch { /* not admin */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  if (!allowed) return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <p className="mt-2 text-sm text-slate-500">{email || 'This account'} is not a platform admin.</p>
        <div className="mt-4"><Button variant="secondary" onClick={() => router.replace('/overview')}>Back to dashboard</Button></div>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <div>
              <div className="text-sm font-semibold leading-tight">Platform Console</div>
              <div className="text-xs text-slate-400">{email}</div>
            </div>
          </div>
          <Button variant="secondary" onClick={() => { tokenStore.clear(); router.replace('/login'); }}>Sign out</Button>
        </div>
        <div className="mx-auto mt-3 flex max-w-6xl gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}>{t}</button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-8">
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Merchants' && <MerchantsTab />}
        {tab === 'Financials' && <FinancialsTab />}
        {tab === 'Payouts' && <PayoutsTab />}
        {tab === 'Ops' && <OpsTab />}
        {tab === 'AI' && <AiTab />}
        {tab === 'Trustee' && <TrusteeTab />}
        {tab === 'Settings' && <SettingsTab />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Overview
function OverviewTab() {
  const [m, setM] = useState<Metrics | null>(null);
  const [rev, setRev] = useState<any>(null);
  const [recon, setRecon] = useState<any>(null);
  useEffect(() => {
    api<Metrics>('/admin/metrics').then(setM).catch(() => {});
    api<any>('/admin/revenue').then(setRev).catch(() => {});
    api<any>('/dashboard/admin/ledger/reconcile').then(setRecon).catch(() => {});
  }, []);
  return (
    <>
      <h2 className="mb-3 text-lg font-semibold">Your platform at a glance</h2>
      {rev && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Transaction fees (USD)" value={`$${rev.transaction_fees_by_currency?.USD ?? '0.00'}`} icon="💰" accent="emerald" hint={rev.transaction_fees_by_currency?.KHR ? `+ ${rev.transaction_fees_by_currency.KHR} KHR` : 'your income'} />
          <Stat label="Subscription rev (30d)" value={`$${rev.subscription_revenue_30d}`} icon="💠" accent="brand" hint={`${rev.subscription_invoices_30d} invoices`} />
          <Stat label="Total revenue (USD)" value={`$${rev.total_revenue_usd}`} icon="📈" accent="brand" />
          <Stat label="Paid subscriptions" value={rev.active_paid_subscriptions} icon="🧾" accent="slate" />
        </div>
      )}
      {m && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Merchants" value={m.organizations} hint={`${m.suspended} suspended`} icon="🏢" accent="brand" />
          <Stat label="Stores" value={m.stores} icon="🏬" accent="slate" />
          <Stat label="Payments" value={m.total_payments} hint={`${m.success_rate}% success`} icon="💳" accent="brand" />
          <Stat label="GMV (paid)" value={`$${m.paid_volume}`} icon="📊" accent="emerald" />
        </div>
      )}
      {recon && (
        <Card className={`mt-4 border-l-4 ${recon.balanced ? 'border-emerald-500' : 'border-red-500'}`}>
          <div className="flex items-center gap-2"><span>{recon.balanced ? '✅' : '⚠️'}</span><span className="font-medium">Books {recon.balanced ? 'reconciled' : `— ${recon.breaks?.length} break(s)`}</span>
            <span className="ml-auto text-xs text-slate-400">see Financials →</span></div>
        </Card>
      )}
    </>
  );
}

// --------------------------------------------------------------- Merchants
function MerchantsTab() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [verifs, setVerifs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setOrgs(await api<any[]>(`/admin/orgs${search ? `?search=${encodeURIComponent(search)}` : ''}`));
    setVerifs(await api<any[]>('/admin/verifications'));
    setPlans(await api<any[]>('/admin/plans'));
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const review = async (orgId: string, approve: boolean) => {
    if (!approve) { const reason = prompt('Rejection reason?') || 'Not specified'; await api(`/admin/verifications/${orgId}/reject`, { method: 'POST', body: { reason } }); }
    else await api(`/admin/verifications/${orgId}/approve`, { method: 'POST' });
    await load();
  };
  const suspend = async (id: string, on: boolean) => { await api(`/admin/orgs/${id}/${on ? 'suspend' : 'reactivate'}`, { method: 'POST' }); await load(); };

  return (
    <>
      {verifs.length > 0 && (
        <Card className="mb-6 border-l-4 border-amber-400">
          <h2 className="mb-2 font-semibold">⏳ KYC pending review ({verifs.length})</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {verifs.map((v) => (
              <li key={v.organization_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{v.organization_name}</b> · {v.legal_name} <span className="text-slate-400">({v.business_type})</span></span>
                <span className="flex gap-2">
                  <button onClick={() => review(v.organization_id, true)} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700">Approve</button>
                  <button onClick={() => review(v.organization_id, false)} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700">Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Merchants</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
      </div>
      <div className="space-y-2">
        {orgs.map((o) => (
          <MerchantRow key={o.id} org={o} plans={plans} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} onSuspend={suspend} onChange={load} />
        ))}
        {orgs.length === 0 && <Card className="text-center text-slate-400">No merchants</Card>}
      </div>
    </>
  );
}

function MerchantRow({ org, plans, open, onToggle, onSuspend, onChange }: { org: any; plans: any[]; open: boolean; onToggle: () => void; onSuspend: (id: string, on: boolean) => void; onChange: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (open) api<any>(`/admin/orgs/${org.id}`).then(setDetail); }, [open, org.id]);

  const setPlan = async (planId: string) => { await api(`/admin/orgs/${org.id}/plan`, { method: 'PUT', body: { planId } }); setMsg('Plan updated'); setTimeout(() => setMsg(''), 1500); onChange(); };
  const setFee = async (storeId: string, pct: string) => { await api(`/admin/stores/${storeId}/fee`, { method: 'PUT', body: { feeBps: Math.round(Number(pct) * 100) } }); setMsg('Fee updated'); setTimeout(() => setMsg(''), 1500); };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onToggle} className="flex items-center gap-2 text-left">
          <span>{open ? '▾' : '▸'}</span>
          <span><b>{org.name}</b> <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{org.plan}</span> <span className="text-xs text-slate-400">· {org.stores} stores · {org.month_paid} paid/mo</span></span>
        </button>
        <span className="flex items-center gap-2">
          {org.status === 'suspended' ? <StatusBadge status="failed" /> : <StatusBadge status="paid" />}
          {org.status === 'suspended'
            ? <button onClick={() => onSuspend(org.id, false)} className="text-xs text-emerald-600 hover:underline">Reactivate</button>
            : <button onClick={() => onSuspend(org.id, true)} className="text-xs text-red-600 hover:underline">Suspend</button>}
        </span>
      </div>
      {open && detail && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          {msg && <div className="mb-2 text-xs text-emerald-600">{msg}</div>}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-slate-600">Plan:</span>
            <select defaultValue={detail.plan_id ?? ''} onChange={(e) => setPlan(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} {p.price_usd_cents ? `($${(p.price_usd_cents / 100).toFixed(0)}/mo)` : '(free)'}</option>)}
            </select>
            <span className="ml-2 text-xs text-slate-400">members: {detail.members.map((m: any) => `${m.email} (${m.role})`).join(', ')}</span>
          </div>
          <div className="text-slate-600">Store fees (per-transaction %):</div>
          <ul className="mt-1 space-y-1">
            {detail.stores.map((s: any) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="min-w-40">{s.name} <span className="text-xs text-slate-400">{s.live_mode ? '· live' : '· test'}</span></span>
                <input defaultValue={(s.fee_bps / 100).toString()} onBlur={(e) => setFee(s.id, e.target.value)} className="w-20 rounded border border-slate-200 px-2 py-1 text-sm" />
                <span className="text-xs text-slate-400">%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- Financials
function FinancialsTab() {
  const [tb, setTb] = useState<any>(null);
  const [recon, setRecon] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    setTb(await api<any>('/dashboard/admin/ledger/trial-balance'));
    setRecon(await api<any>('/dashboard/admin/ledger/reconcile'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const backfill = async () => { setMsg('Posting…'); const r = await api<any>('/dashboard/admin/ledger/backfill', { method: 'POST' }); setMsg(`Backfilled ${r.payments} payments, ${r.refunds} refunds, ${r.commissions} commissions`); await load(); };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Platform ledger & reconciliation</h2>
        <Button variant="secondary" onClick={backfill}>Backfill from records</Button>
      </div>
      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}
      {recon && (
        <Card className={`mb-4 border-l-4 ${recon.balanced ? 'border-emerald-500' : 'border-red-500'}`}>
          <div className="mb-2 font-medium">{recon.balanced ? '✅ Reconciliation clean' : `⚠️ ${recon.breaks?.length} break(s)`}</div>
          <ul className="text-sm">{recon.checks?.map((c: any) => <li key={c.id} className="py-0.5">{c.ok ? '🟢' : '🔴'} {c.label} {c.detail && <span className="text-xs text-slate-400">— {c.detail}</span>}</li>)}</ul>
        </Card>
      )}
      {tb && (
        <Card className="overflow-x-auto">
          <h3 className="mb-2 font-semibold">Trial balance {tb.in_balance ? <span className="text-sm text-emerald-600">· in balance</span> : <span className="text-sm text-red-600">· OUT OF BALANCE</span>}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-400"><th className="py-1">Account</th><th>Type</th><th>Cur</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {tb.accounts?.map((a: any) => (
                <tr key={a.account + a.currency} className="border-t border-slate-50">
                  <td className="py-1.5">{a.account.replace(/_/g, ' ')}</td><td className="text-xs text-slate-500">{a.type}</td><td>{a.currency}</td>
                  <td className="text-right">{a.debit}</td><td className="text-right">{a.credit}</td><td className="text-right font-medium">{a.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">“fee revenue” is your transaction income; “merchant payable” is what you owe merchants.</p>
        </Card>
      )}
    </>
  );
}

// --------------------------------------------------------------- Ops
function OpsTab() {
  const [posture, setPosture] = useState<any>(null);
  const [mon, setMon] = useState<any>(null);
  useEffect(() => {
    api<any>('/admin/security/posture').then(setPosture).catch(() => {});
    api<any>('/admin/security/monitoring').then(setMon).catch(() => {});
  }, []);
  return (
    <>
      {mon && (
        <>
          <h2 className="mb-2 text-lg font-semibold">System health</h2>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Status" value={mon.healthy ? 'Healthy' : 'Degraded'} accent={mon.healthy ? 'emerald' : 'red'} icon={mon.healthy ? '🟢' : '🔴'} />
            <Stat label="DB latency" value={`${mon.db?.latency_ms}ms`} accent="slate" />
            <Stat label="Webhook backlog" value={mon.queue?.webhook_backlog} accent={mon.queue?.webhook_backlog > 100 ? 'amber' : 'slate'} />
            <Stat label="Paid / 1h" value={mon.throughput_1h?.paid} accent="brand" hint={`${mon.throughput_1h?.failed} failed`} />
          </div>
        </>
      )}
      {posture && (
        <Card className="mb-6">
          <h3 className="mb-2 font-semibold">Security posture <span className="text-sm text-slate-500">· {posture.score}%</span></h3>
          <ul className="text-sm">{posture.checks?.map((c: any) => <li key={c.id} className="flex items-center gap-2 py-0.5"><span>{c.status === 'pass' ? '🟢' : c.status === 'warn' ? '🟡' : '🔴'}</span>{c.label} <span className="text-xs text-slate-400">— {c.detail}</span></li>)}</ul>
        </Card>
      )}
      <AlertsCard />
      <SupportConsole />
    </>
  );
}

function AlertsCard() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await api<any>('/admin/alerts/test', { method: 'POST', body: {} });
      const ch = Object.entries(r.channels).filter(([, v]) => v).map(([k]) => k).join(', ');
      setMsg(`Test alert dispatched → ${ch || 'log only (no channels configured)'}`);
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
    setBusy(false); setTimeout(() => setMsg(''), 5000);
  };
  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Operational alerts</h3>
          <p className="text-sm text-slate-500">5xx errors and failed payouts fan out to Sentry, Telegram, and email. Configure targets in Settings → integration keys (Alerts group).</p>
        </div>
        <button onClick={test} disabled={busy} className="shrink-0 rounded-md border border-brand-200 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50 disabled:opacity-50">{busy ? 'Sending…' : 'Send test alert'}</button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-600">{msg}</p>}
    </Card>
  );
}

// --------------------------------------------------------------- AI
function AiTab() {
  const [usage, setUsage] = useState<any>(null);
  const [reg, setReg] = useState<any>(null);
  useEffect(() => {
    api<any>('/dashboard/admin/ai/usage').then(setUsage).catch(() => {});
    api<any>('/dashboard/admin/ai/registry').then(setReg).catch(() => {});
  }, []);
  return (
    <>
      <h2 className="mb-2 text-lg font-semibold">AI usage & cost (30 days)</h2>
      {usage && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Calls" value={usage.total_calls} icon="✨" accent="brand" />
          <Stat label="Est. cost" value={usage.total_cost} icon="💵" accent="emerald" />
          <Stat label="Blocked" value={usage.blocked_calls} icon="⛔" accent={usage.blocked_calls ? 'red' : 'slate'} />
        </div>
      )}
      {usage?.by_model && (
        <Card className="mb-4">
          <div className="mb-1 text-sm font-medium">By model</div>
          <ul className="text-sm">{usage.by_model.map((m: any) => <li key={m.model} className="flex justify-between py-0.5"><span className="font-mono text-xs">{m.model}</span><span>{m.calls} calls · {m.cost}</span></li>)}</ul>
        </Card>
      )}
      {reg?.models && (
        <Card>
          <div className="mb-1 text-sm font-medium">Model registry</div>
          <ul className="text-sm">{reg.models.map((m: any) => <li key={m.id} className="py-1"><b>{m.family}</b> <span className="rounded bg-slate-100 px-1.5 text-xs">{m.status}</span> <span className="text-xs text-slate-400">— {m.use}</span></li>)}</ul>
        </Card>
      )}
    </>
  );
}

// --------------------------------------------------------------- Payouts
function PayoutsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    setRows(await api<any[]>('/admin/payouts'));
    try { setHistory(await api<any[]>('/admin/payouts/history')); } catch { /* older api */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  const pay = async (r: any) => {
    if (!confirm(`Record a MANUAL payout of ${r.owed} ${r.currency} to ${r.merchant} (${r.store})?\n\nMark paid means you have transferred the funds out-of-band (bank/Bakong app).`)) return;
    const res = await api<any>(`/admin/stores/${r.store_id}/payout`, { method: 'POST', body: { currency: r.currency, amount: r.owed, method: 'manual' } });
    setMsg(res.status === 'paid' ? `Paid ${r.owed} ${r.currency} to ${r.merchant}` : `Payout ${res.status}: ${res.failure_reason ?? ''}`);
    setTimeout(() => setMsg(''), 3000); await load();
  };
  const total = rows.reduce((a, r) => a + Number(r.owed), 0);
  const statusColor = (s: string) => s === 'paid' ? 'text-emerald-600' : s === 'failed' ? 'text-rose-600' : 'text-amber-600';
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Merchant payouts</h2>
        <span className="text-sm text-slate-500">Outstanding: <b>{total.toFixed(2)}</b></span>
      </div>
      <p className="mb-3 text-sm text-slate-500">What you owe each merchant (their net after your fees). A <b>manual</b> payout records a transfer you made out-of-band and posts it to the ledger, clearing the balance. Automated Bakong disbursement activates once disbursement credentials are set.</p>
      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr><th className="px-4 py-3">Merchant</th><th className="px-4 py-3">Store</th><th className="px-4 py-3 text-right">Owed</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.store_id + r.currency} className="border-b border-slate-50">
                <td className="px-4 py-3 font-medium">{r.merchant}</td>
                <td className="px-4 py-3 text-slate-500">{r.store}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.owed} <span className="text-xs font-normal text-slate-400">{r.currency}</span></td>
                <td className="px-4 py-3 text-right"><button onClick={() => pay(r)} className="rounded-md border border-brand-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">Mark paid</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Nothing outstanding — all merchants settled. 🎉</td></tr>}
          </tbody>
        </table>
      </Card>

      {history.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-600">Payout history</h3>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Merchant</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{p.merchant} <span className="text-xs text-slate-400">/ {p.store}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.amount} <span className="text-xs text-slate-400">{p.currency}</span></td>
                    <td className="px-4 py-3 capitalize text-slate-500">{p.method}</td>
                    <td className={`px-4 py-3 font-medium capitalize ${statusColor(p.status)}`}>{p.status}{p.failure_reason ? <span className="block text-xs font-normal text-slate-400">{p.failure_reason}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}

function SettingsTab() {
  return <><PlansManager /><SystemSettings /><ChangePassword /></>;
}

function TrusteeTab() {
  const [status, setStatus] = useState<any>(null);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string>('');
  const load = useCallback(async () => {
    setStatus(await api<any>('/admin/trustee/status'));
    const listed = await api<{ data: any[] }>('/admin/trustee/artifacts?limit=20');
    setArtifacts(listed.data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (type: string) => {
    setBusy(type);
    try {
      const r = await api<any>('/admin/trustee/artifacts', { method: 'POST', body: { type } });
      setMsg(`${r.type} created`);
      await navigator.clipboard.writeText(JSON.stringify(r, null, 2)).catch(() => undefined);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy('');
      setTimeout(() => setMsg(''), 2500);
    }
  };

  const tone = (ok: boolean) => ok ? 'text-emerald-600' : 'text-rose-600';

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trustee readiness</h2>
          <p className="text-sm text-slate-500">Platform-level trustee configuration, verifier keys, books health, and signed regulator artifacts.</p>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>
      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}
      {status && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Overall" value={status.ready ? 'Ready' : 'Not ready'} icon={status.ready ? '✅' : '⚠️'} accent={status.ready ? 'emerald' : 'red'} />
            <Stat label="Trustee base URL" value={status.trustee.base_url ? 'Set' : 'Unset'} icon="🏦" accent={status.trustee.base_url ? 'brand' : 'red'} />
            <Stat label="PayChain orgs" value={status.paychain.organizations_connected} hint={`${status.paychain.webhooks_connected} webhooks`} icon="⛓️" accent="brand" />
            <Stat label="Books" value={status.ledger.in_balance ? 'Balanced' : 'Breaks'} hint={status.points.ok ? 'points aligned' : 'points drift'} icon="📚" accent={status.ledger.in_balance && status.points.ok ? 'emerald' : 'red'} />
          </div>

          <Card className="mb-4">
            <h3 className="mb-2 font-semibold">Readiness gates</h3>
            <ul className="space-y-1 text-sm">
              <li className={tone(!!status.trustee.base_url)}>Trustee base URL configured: {status.trustee.base_url ?? 'missing'}</li>
              <li className={tone(status.trustee.request_signing_configured)}>Trustee request-signing key configured: {status.trustee.request_signing_key_id ?? 'missing'}</li>
              <li className={tone(status.trustee.artifact_signing_configured)}>Trustee artifact-signing key configured: {status.trustee.artifact_signing_key_id ?? 'missing'}</li>
              <li className={tone(status.ledger.reconciliation.balanced)}>Ledger reconciliation: {status.ledger.reconciliation.balanced ? 'clean' : 'breaks present'}</li>
              <li className={tone(status.points.ok)}>Points drift: {status.points.ok ? 'none' : `${status.points.drift_count} drifted customer(s)`}</li>
            </ul>
          </Card>

          <Card className="mb-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <Button onClick={() => create('TRUSTEE_READINESS')} disabled={!!busy}>{busy === 'TRUSTEE_READINESS' ? 'Creating…' : 'Create readiness packet'}</Button>
              <Button variant="secondary" onClick={() => create('RESERVE_SNAPSHOT')} disabled={!!busy}>{busy === 'RESERVE_SNAPSHOT' ? 'Creating…' : 'Create reserve snapshot'}</Button>
              <Button variant="secondary" onClick={() => create('MINT_POLICY')} disabled={!!busy}>{busy === 'MINT_POLICY' ? 'Creating…' : 'Create mint policy'}</Button>
            </div>
            <p className="text-xs text-slate-400">Each packet is Ed25519-signed server-side and copied to your clipboard after creation.</p>
          </Card>

          <Card className="mb-4">
            <h3 className="mb-2 font-semibold">Verifier keys</h3>
            <p className="text-sm text-slate-500">Expose these publicly at <span className="font-mono">/.well-known/paykh-trustee-keys</span> for trustee and regulator verification.</p>
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-600">/.well-known/paykh-trustee-keys</div>
          </Card>
        </>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-slate-100 px-4 py-3 font-semibold">Signed artifacts</div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Type</th><th className="px-4 py-3">Key</th><th className="px-4 py-3">When</th><th className="px-4 py-3">Note</th></tr>
          </thead>
          <tbody>
            {artifacts.map((a) => (
              <tr key={a.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-medium">{a.type}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.key_id}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-500">{a.note ?? '—'}</td>
              </tr>
            ))}
            {artifacts.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No trustee artifacts yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function PlansManager() {
  const [plans, setPlans] = useState<any[]>([]);
  const [edit, setEdit] = useState<Record<string, { price: string; fee: string }>>({});
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { setPlans(await api<any[]>('/admin/plans')); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (p: any) => {
    const e = edit[p.id] ?? { price: (p.price_usd_cents / 100).toString(), fee: (p.default_fee_bps / 100).toString() };
    await api('/admin/plans', { method: 'POST', body: { id: p.id, name: p.name, monthlyPaidQuota: p.monthly_quota, priceUsdCents: Math.round(Number(e.price) * 100), defaultFeeBps: Math.round(Number(e.fee) * 100) } });
    setMsg(`${p.name} saved`); setTimeout(() => setMsg(''), 1500); await load();
  };
  return (
    <>
      <h2 className="mb-2 text-lg font-semibold">Plans & pricing</h2>
      <p className="mb-3 text-sm text-slate-500">Set each plan’s monthly price and the default transaction fee new stores on that plan inherit. {msg && <span className="text-emerald-600">· {msg}</span>}</p>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-400"><th className="py-1">Plan</th><th>Quota/mo</th><th>Price $/mo</th><th>Default fee %</th><th></th></tr></thead>
          <tbody>
            {plans.map((p) => {
              const e = edit[p.id] ?? { price: (p.price_usd_cents / 100).toString(), fee: ((p.default_fee_bps ?? 0) / 100).toString() };
              return (
                <tr key={p.id} className="border-t border-slate-50">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td>{p.monthly_quota === -1 ? '∞' : p.monthly_quota}</td>
                  <td><input value={e.price} onChange={(ev) => setEdit((s) => ({ ...s, [p.id]: { ...e, price: ev.target.value } }))} className="w-20 rounded border border-slate-200 px-2 py-1 text-sm" /></td>
                  <td><input value={e.fee} onChange={(ev) => setEdit((s) => ({ ...s, [p.id]: { ...e, fee: ev.target.value } }))} className="w-20 rounded border border-slate-200 px-2 py-1 text-sm" /></td>
                  <td><Button onClick={() => save(p)}>Save</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ================================================================ helpers
interface Queue { name: string; waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number; paused?: number; healthy: boolean; error?: string }

function SupportConsole() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ queues: Queue[] }>('/admin/queues').then((d) => setQueues(d.queues)).catch(() => {}); }, []);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setRes(await api<any>(`/admin/support/search?q=${encodeURIComponent(q.trim())}`)); } catch { setRes(null); }
    setBusy(false);
  };

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-semibold">Queue monitor</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-2">
        {queues.map((qq) => (
          <Card key={qq.name}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{qq.name}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${qq.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
            {qq.error ? <p className="mt-1 text-xs text-red-500">{qq.error}</p> : (
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
                <span>waiting <b>{qq.waiting ?? 0}</b></span>
                <span>active <b>{qq.active ?? 0}</b></span>
                <span>delayed <b>{qq.delayed ?? 0}</b></span>
                <span className={((qq.failed ?? 0) > 0) ? 'text-red-500' : ''}>failed <b>{qq.failed ?? 0}</b></span>
                <span>done <b>{qq.completed ?? 0}</b></span>
              </div>
            )}
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-semibold">Support lookup</h2>
      <Card className="mb-6">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="payment id, reference, customer email/phone, store or org name…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <Button onClick={run} disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button>
        </div>
        {res && (
          <div className="mt-4 space-y-3 text-sm">
            {(['payments', 'customers', 'stores', 'organizations'] as const).map((k) => res[k]?.length > 0 && (
              <div key={k}>
                <div className="mb-1 font-medium capitalize text-slate-600">{k}</div>
                <ul className="divide-y divide-slate-100">
                  {res[k].map((row: any) => (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="font-mono text-xs">{row.id}</span>
                      <span className="text-slate-600">{row.name ?? row.email ?? row.reference_id ?? ''} {row.amount ? `· ${row.amount} ${row.currency}` : ''} {row.status ? `· ${row.status}` : ''} {row.live_mode !== undefined ? (row.live_mode ? '· live' : '· test') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(['payments', 'customers', 'stores', 'organizations'] as const).every((k) => !res[k]?.length) && <p className="text-slate-400">No matches.</p>}
          </div>
        )}
      </Card>
    </>
  );
}

interface Setting { key: string; label: string; group: string; secret: boolean; configured: boolean; source: string; preview: string | null }

function SystemSettings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const load = () => api<{ settings: Setting[] }>('/admin/settings').then((d) => setSettings(d.settings)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const value = edit[key];
    if (!value) return;
    await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
    setEdit((e) => ({ ...e, [key]: '' })); setMsg(`${key} saved`); setTimeout(() => setMsg(''), 2000); await load();
  };
  const clear = async (key: string) => { await api(`/admin/settings/${key}`, { method: 'DELETE' }); await load(); };

  const groups = [...new Set(settings.map((s) => s.group))];
  const badge = (src: string) => src === 'db' ? 'bg-emerald-50 text-emerald-700' : src === 'env' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700';

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-semibold">System settings</h2>
      <p className="mb-3 text-sm text-slate-500">Integration keys, encrypted at rest. A saved value overrides the environment variable — no redeploy needed. {msg && <span className="text-emerald-600">· {msg}</span>}</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g}>
            <div className="mb-2 text-sm font-semibold text-slate-700">{g}</div>
            <div className="space-y-3">
              {settings.filter((s) => s.group === g).map((s) => (
                <div key={s.key} className="flex flex-wrap items-center gap-3">
                  <div className="min-w-48 flex-1">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${badge(s.source)}`}>{s.source}</span>
                      {s.preview && <span className="font-mono text-slate-400">{s.preview}</span>}
                    </div>
                  </div>
                  <input type={s.secret ? 'password' : 'text'} value={edit[s.key] ?? ''} onChange={(e) => setEdit((p) => ({ ...p, [s.key]: e.target.value }))} placeholder={s.configured ? 'Replace…' : 'Set value…'} className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <Button onClick={() => save(s.key)}>Save</Button>
                  {s.source === 'db' && <button onClick={() => clear(s.key)} className="text-xs text-red-500 hover:underline">Clear</button>}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) { setMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: 'Passwords do not match.' }); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setMsg({ ok: true, text: 'Password changed ✓' }); setCurrent(''); setNext(''); setConfirm('');
    } catch (err: any) { setMsg({ ok: false, text: err.message || 'Failed' }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-semibold">Change password</h2>
      <Card>
        <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" required className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" required className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" required className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</Button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
          </div>
        </form>
      </Card>
    </>
  );
}
