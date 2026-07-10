'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api, API_BASE, tokenStore } from '@/lib/api';
import { Payment } from '@/lib/types';

interface PaymentList {
  data: Payment[];
  has_more: boolean;
  next_cursor: string | null;
}

export default function PaymentsPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? (
          <PaymentsContent storeId={activeStore.id} />
        ) : (
          <Card className="text-slate-600">Create a store first.</Card>
        )
      }
    </Shell>
  );
}

function PaymentsContent({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Payment[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const res = await api<PaymentList>(`/dashboard/stores/${storeId}/payments?${params}`);
    setItems(res.data);
  }, [storeId, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    const header = ['id', 'status', 'amount', 'currency', 'reference_id', 'created_at', 'paid_at'];
    const rows = items.map((p) =>
      [p.id, p.status, p.amount, p.currency, p.reference_id ?? '', p.created_at, p.paid_at ?? ''].join(','),
    );
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${storeId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageTitle title="Payments" action={<Button variant="secondary" onClick={exportCsv}>Export CSV</Button>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search id or reference"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {['pending', 'scanned', 'paid', 'expired', 'failed', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={load}>Filter</Button>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No payments yet</td>
              </tr>
            )}
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => setDetail(p)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-mono text-xs">{p.id}</td>
                <td className="px-4 py-3">{p.amount} {p.currency}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-3 text-slate-500">{p.reference_id ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(p.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {detail && <PaymentDrawer id={detail.id} onClose={() => setDetail(null)} />}
    </>
  );
}

function PaymentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`${API_BASE}/dashboard/payments/${id}`, {
      headers: { Authorization: `Bearer ${tokenStore.get()}` },
    })
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {!data ? (
          <p className="mt-6 text-slate-400">Loading…</p>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <Row k="ID" v={<span className="font-mono text-xs">{data.id}</span>} />
            <Row k="Status" v={<StatusBadge status={data.status} />} />
            <Row k="Amount" v={`${data.amount} ${data.currency}`} />
            <Row k="Mode" v={data.mode} />
            <Row k="Reference" v={data.reference_id ?? '—'} />
            <Row k="Created" v={new Date(data.created_at).toLocaleString()} />
            <Row k="Paid at" v={data.paid_at ? new Date(data.paid_at).toLocaleString() : '—'} />
            {data.provider_reference && (
              <Row k="Provider md5" v={<span className="font-mono text-xs">{data.provider_reference.md5}</span>} />
            )}
            <div>
              <div className="mb-2 font-medium text-slate-700">Timeline</div>
              <ol className="space-y-2 border-l border-slate-200 pl-4">
                {(data.timeline ?? []).map((t: any, i: number) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-500" />
                    <div className="text-slate-800">{t.from ? `${t.from} → ` : ''}{t.to}</div>
                    <div className="text-xs text-slate-400">{new Date(t.at).toLocaleString()} · {t.reason}</div>
                  </li>
                ))}
              </ol>
            </div>
            {data.metadata && Object.keys(data.metadata).length > 0 && (
              <div>
                <div className="mb-1 font-medium text-slate-700">Metadata</div>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(data.metadata, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 pb-2">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-800">{v}</span>
    </div>
  );
}
