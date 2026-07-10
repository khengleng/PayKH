'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, Stat, StatusBadge } from '@/components/ui';
import { api, API_BASE, tokenStore } from '@/lib/api';

interface Customer { id: string; name: string | null; email: string | null; phone: string | null; external_id: string | null; created_at: string }

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
            <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">External ID</th><th className="px-4 py-3">Since</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No customers yet. Create them via the API (POST /v1/customers) or attach a customer_id to a payment.</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => setDetail(c.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">{c.name ?? <span className="text-slate-400">—</span>}<div className="font-mono text-[10px] text-slate-400">{c.id}</div></td>
                <td className="px-4 py-3 text-slate-600">{c.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{c.external_id ?? '—'}</td>
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
  useEffect(() => {
    fetch(`${API_BASE}/dashboard/customers/${id}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      .then((r) => r.json()).then(setData);
  }, [id]);

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Customer 360</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {!data ? <p className="mt-6 text-slate-400">Loading…</p> : (
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <div className="text-lg font-medium">{data.name ?? '—'}</div>
              <div className="text-slate-500">{data.email ?? ''} {data.phone ? `· ${data.phone}` : ''}</div>
              {data.external_id && <div className="text-xs text-slate-400">external: {data.external_id}</div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Lifetime value" value={`$${data.metrics.lifetime_value}`} />
              <Stat label="Paid payments" value={data.metrics.paid_count} />
              <Stat label="Paid volume" value={`$${data.metrics.paid_volume}`} />
              <Stat label="Refunded" value={`$${data.metrics.refunded_total}`} />
            </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
