'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';

interface GiftCard {
  id: string;
  code: string;
  currency: 'USD' | 'KHR';
  initial_balance: string;
  balance: string;
  customer_id: string | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
}

export default function GiftCardsPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<GiftCard[]>([]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'KHR'>('USD');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issued, setIssued] = useState<GiftCard | null>(null);

  const load = useCallback(async () => { setRows(await api<GiftCard[]>(`/dashboard/stores/${storeId}/gift-cards`)); }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const fmt = (n: string, c: 'USD' | 'KHR') => (c === 'KHR' ? `${Math.round(Number(n)).toLocaleString()}៛` : `$${Number(n).toFixed(2)}`);

  const issue = async () => {
    if (!amount || Number(amount) <= 0) return;
    setBusy(true); setErr('');
    try {
      const card = await api<GiftCard>(`/dashboard/stores/${storeId}/gift-cards`, {
        method: 'POST',
        body: { amount, currency, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) },
      });
      setIssued(card); setAmount(''); setExpiresAt('');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageTitle title="Gift Cards" subtitle="Prepaid store credit customers spend at checkout. The balance is held on PayChain (money-value), mirrored here." />

      <Card className="mb-6">
        <h3 className="mb-3 font-semibold">Issue a gift card</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Amount</div>
            <div className="flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="50.00" className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'KHR')} className="rounded-lg border border-slate-200 px-2 py-2 text-sm"><option>USD</option><option>KHR</option></select>
            </div>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Expires (optional)</div>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <Button onClick={issue} disabled={busy || !amount}>{busy ? 'Issuing…' : 'Issue card'}</Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        {issued && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm text-emerald-800">Issued <span className="font-semibold">{fmt(issued.initial_balance, issued.currency)}</span> gift card. Share this code with the customer:</div>
            <div className="mt-1 font-mono text-lg font-bold tracking-wider text-emerald-900">{issued.code}</div>
          </div>
        )}
      </Card>

      <Card className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No gift cards yet — issue one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Code</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((c) => {
                  const depleted = Number(c.balance) <= 0;
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono font-medium text-slate-800">{c.code}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{fmt(c.balance, c.currency)} <span className="text-xs font-normal text-slate-400">/ {fmt(c.initial_balance, c.currency)}</span></td>
                      <td className="px-4 py-3 text-slate-400">{new Date(c.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3"><StatusBadge status={!c.active ? 'inactive' : depleted ? 'empty' : 'active'} /></td>
                      <td className="px-4 py-3 text-slate-500">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
