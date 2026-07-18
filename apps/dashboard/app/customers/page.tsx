'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, Stat, StatusBadge } from '@/components/ui';
import { api, API_BASE, tokenStore } from '@/lib/api';

interface Customer { id: string; name: string | null; email: string | null; phone: string | null; external_id: string | null; created_at: string; points_balance: number; lifetime_points: number }

export default function CustomersPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>
      }
    </Shell>
  );
}

function Content({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ data: Customer[] }>(`/dashboard/stores/${storeId}/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    setItems(res.data);
  }, [storeId, search]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageTitle title="Customers" subtitle="Customer 360 — profiles and lifetime value." />
      <div className="mb-4 flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / email / external id" className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <Button variant="secondary" onClick={load}>Search</Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3 text-right">Points</th><th className="px-4 py-3">Since</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No customers yet. Create them via the API (POST /v1/customers) or attach a customer_id to a payment.</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => setDetail(c.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">{c.name ?? <span className="text-slate-400">—</span>}<div className="font-mono text-[10px] text-slate-400">{c.id}</div></td>
                <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-700">{c.points_balance.toLocaleString()}<div className="text-[10px] font-normal text-slate-400">{c.lifetime_points.toLocaleString()} lifetime</div></td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {detail && <Customer360 id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Customer360({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [qr, setQr] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/dashboard/customers/${id}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      .then((r) => r.json()).then(setData);
  }, [id]);

  const loadQr = async () => {
    const r = await fetch(`${API_BASE}/dashboard/customers/${id}/referral-qr`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    setQr(await r.json());
  };

  const togglePref = async (channel: string, optedIn: boolean) => {
    const r = await fetch(`${API_BASE}/dashboard/customers/${id}/preferences`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.get()}` },
      body: JSON.stringify({ preferences: { [channel]: optedIn } }),
    });
    const d = await r.json();
    setData((prev: any) => ({ ...prev, preferences: d.preferences }));
  };

  const erasePii = async () => {
    if (!confirm('Permanently anonymize this customer’s PII? Financial records (payments, ledger) are preserved. This cannot be undone.')) return;
    await fetch(`${API_BASE}/dashboard/customers/${id}/pii`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    const r = await fetch(`${API_BASE}/dashboard/customers/${id}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
    setData(await r.json());
  };

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Customer 360</h2>
          <div className="flex items-center gap-3">
            {data && data.name !== '[erased]' && <button onClick={erasePii} className="text-xs text-red-500 hover:underline">Erase PII</button>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
        </div>
        {!data ? <p className="mt-6 text-slate-400">Loading…</p> : (
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-medium">{data.name ?? '—'}</span>
                {data.tier && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{data.tier.name} · ×{data.tier.earn_multiplier}</span>}
              </div>
              <div className="text-slate-500">{data.email ?? ''} {data.phone ? `· ${data.phone}` : ''}</div>
              {data.external_id && <div className="text-xs text-slate-400">external: {data.external_id}</div>}
              <div className="text-xs text-slate-400">lifetime points: {data.lifetime_points ?? 0}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Lifetime value" value={`$${data.metrics.lifetime_value}`} />
              <Stat label="Loyalty points" value={data.points_balance ?? 0} />
              <Stat label="Paid payments" value={data.metrics.paid_count} />
              <Stat label="Paid volume" value={`$${data.metrics.paid_volume}`} />
            </div>
            <PointsManager
              customerId={id}
              balance={data.points_balance ?? 0}
              onBalance={(bal) => setData((prev: any) => ({ ...prev, points_balance: bal }))}
            />
            <div>
              <div className="mb-2 font-medium text-slate-700">Recent payments</div>
              <ul className="divide-y divide-slate-100">
                {(data.recent_payments ?? []).map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span className="font-mono text-xs">{p.id}</span>
                    <span>{p.amount} {p.currency}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
                {(!data.recent_payments || data.recent_payments.length === 0) && <li className="py-2 text-slate-400">No payments yet.</li>}
              </ul>
            </div>
            {data.preferences && (
              <div>
                <div className="mb-2 font-medium text-slate-700">Communication preferences</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.preferences as Record<string, boolean>).map(([ch, on]) => (
                    <button key={ch} onClick={() => togglePref(ch, !on)}
                      className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400 line-through'}`}>
                      {ch}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-400">Click to opt in/out. Changes are recorded in the consent log.</p>
              </div>
            )}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-slate-700">Referral QR</span>
                {!qr && <button onClick={loadQr} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50">Generate</button>}
              </div>
              {qr && (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.qr_png_data_url} alt="Referral QR" className="h-28 w-28 rounded-lg border border-slate-100" />
                  <div className="min-w-0 text-xs">
                    <div className="font-mono text-slate-700">{qr.referral_code}</div>
                    <a href={qr.share_url} target="_blank" rel="noreferrer" className="break-all text-blue-600 hover:underline">{qr.share_url}</a>
                    <div className="mt-1"><a href={qr.qr_png_data_url} download={`${qr.referral_code}.png`} className="text-slate-500 hover:underline">Download PNG</a></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface PointsTxn { id: string; type: string; points: number; payment_id: string | null; reason: string | null; created_at: string }

/**
 * Manual points control + ledger for one customer. A merchant can grant or
 * deduct points (goodwill, a correction, an in-store reward) and see every
 * movement — the adjust and ledger endpoints existed but had no UI.
 */
function PointsManager({ customerId, balance, onBalance }: { customerId: string; balance: number; onBalance: (bal: number) => void }) {
  const [txns, setTxns] = useState<PointsTxn[]>([]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  const loadLedger = useCallback(async () => {
    const r = await api<{ balance: number; transactions: PointsTxn[] }>(`/dashboard/customers/${customerId}/loyalty`);
    setTxns(r.transactions);
    onBalance(r.balance);
  }, [customerId, onBalance]);
  useEffect(() => { loadLedger(); }, [loadLedger]);

  const adjust = async (sign: 1 | -1) => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ balance: number }>(`/dashboard/customers/${customerId}/loyalty/adjust`, {
        method: 'POST',
        body: { points: sign * n, reason: reason.trim() || undefined },
      });
      onBalance(r.balance);
      setAmount(''); setReason('');
      await loadLedger();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-slate-700">Loyalty points</span>
        <span className="tabular-nums text-lg font-semibold text-slate-800">{balance.toLocaleString()}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          placeholder="Points"
          className="w-24 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
        />
        <Button size="sm" onClick={() => adjust(1)} disabled={busy || !amount}>Grant</Button>
        <Button size="sm" variant="danger" onClick={() => adjust(-1)} disabled={busy || !amount}>Deduct</Button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      <button onClick={() => setOpen((o) => !o)} className="mt-2 text-xs text-slate-500 hover:text-slate-700">
        {open ? 'Hide' : 'Show'} points history ({txns.length})
      </button>
      {open && (
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {txns.length === 0 && <li className="py-2 text-xs text-slate-400">No points activity yet.</li>}
          {txns.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-1.5 text-xs">
              <div>
                <span className="font-medium capitalize text-slate-700">{t.type}</span>
                {t.reason && <span className="text-slate-400"> · {t.reason}</span>}
                <div className="text-[10px] text-slate-400">{new Date(t.created_at).toLocaleString()}</div>
              </div>
              <span className={`tabular-nums font-medium ${t.points >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{t.points >= 0 ? '+' : ''}{t.points.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
