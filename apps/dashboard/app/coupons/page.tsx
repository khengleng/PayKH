'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';

interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  currency: 'USD' | 'KHR' | null;
  min_spend: string | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
  redemption_count: number;
  active: boolean;
  expires_at: string | null;
}

export default function CouponsPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('10');
  const [currency, setCurrency] = useState<'USD' | 'KHR'>('USD');
  const [minSpend, setMinSpend] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [perCustomer, setPerCustomer] = useState('');
  const [firstOrder, setFirstOrder] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => { setRows(await api<Coupon[]>(`/dashboard/stores/${storeId}/coupons`)); }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!code.trim() || !value) return;
    setBusy(true); setErr('');
    try {
      await api(`/dashboard/stores/${storeId}/coupons`, {
        method: 'POST',
        body: {
          code: code.trim(),
          type,
          value,
          ...(type === 'FIXED' ? { currency } : {}),
          ...(minSpend ? { minSpend } : {}),
          ...(maxRedemptions ? { maxRedemptions: Number(maxRedemptions) } : {}),
          ...(perCustomer ? { perCustomerLimit: Number(perCustomer) } : {}),
          ...(firstOrder ? { firstOrderOnly: true } : {}),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        },
      });
      setCode(''); setMinSpend(''); setMaxRedemptions(''); setPerCustomer(''); setFirstOrder(false); setExpiresAt('');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggle = async (c: Coupon) => { await api(`/dashboard/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); await load(); };
  const del = async (c: Coupon) => { if (!confirm(`Delete "${c.code}"?`)) return; await api(`/dashboard/coupons/${c.id}`, { method: 'DELETE' }); await load(); };

  const discountLabel = (c: Coupon) => (c.type === 'PERCENT' ? `${c.value}% off` : `${c.value} ${c.currency ?? ''} off`);

  return (
    <>
      <PageTitle title="Coupons" subtitle="Discount codes customers enter at checkout to pay less — applied to the actual amount, not points." />

      <Card className="mb-6">
        <h3 className="mb-3 font-semibold">New discount code</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Code</div>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SAVE10" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm uppercase" />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Type</div>
            <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="PERCENT">Percent off</option>
              <option value="FIXED">Fixed amount off</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{type === 'PERCENT' ? 'Percent (1–100)' : 'Amount off'}</div>
            <div className="flex gap-2">
              <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              {type === 'FIXED' && (
                <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'KHR')} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
                  <option>USD</option><option>KHR</option>
                </select>
              )}
            </div>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Min spend (optional)</div>
            <input value={minSpend} onChange={(e) => setMinSpend(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="—" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Total uses (optional)</div>
            <input value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value.replace(/[^0-9]/g, ''))} placeholder="∞" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Per customer (optional)</div>
            <input value={perCustomer} onChange={(e) => setPerCustomer(e.target.value.replace(/[^0-9]/g, ''))} placeholder="∞" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Expires (optional)</div>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={firstOrder} onChange={(e) => setFirstOrder(e.target.checked)} /> First order only
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={create} disabled={busy || !code.trim() || !value}>{busy ? 'Creating…' : 'Create code'}</Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </Card>

      <Card className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No codes yet — create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Code</th><th className="px-4 py-3">Discount</th><th className="px-4 py-3">Rules</th><th className="px-4 py-3">Used</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">{c.code}</td>
                    <td className="px-4 py-3">{discountLabel(c)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {[c.min_spend ? `min ${c.min_spend}` : null, c.max_redemptions ? `${c.max_redemptions} total` : null, c.per_customer_limit ? `${c.per_customer_limit}/customer` : null, c.first_order_only ? '1st order' : null, c.expires_at ? `exp ${new Date(c.expires_at).toLocaleDateString()}` : null].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{c.redemption_count}{c.max_redemptions ? `/${c.max_redemptions}` : ''}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.active ? 'active' : 'inactive'} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</Button>
                        <Button size="sm" variant="danger" onClick={() => del(c)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
