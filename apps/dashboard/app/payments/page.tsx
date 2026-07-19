'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api, API_BASE, tokenStore } from '@/lib/api';
import { Payment } from '@/lib/types';
import { DetectedPayments } from './DetectedPayments';

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

      <DetectedPayments storeId={storeId} onConfirmed={load} />

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
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="text-3xl">🧾</div>
                  <div className="mt-2 text-slate-500">No payments yet</div>
                  <div className="text-xs text-slate-400">Payments will appear here as they come in.</div>
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => setDetail(p)}
                className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-brand-50/40"
              >
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.id}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{p.amount} <span className="text-xs font-normal text-slate-400">{p.currency}</span></td>
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
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const load = () =>
    fetch(`${API_BASE}/dashboard/payments/${id}`, {
      headers: { Authorization: `Bearer ${tokenStore.get()}` },
    })
      .then((r) => r.json())
      .then(setData);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const doRefund = async () => {
    setRefundBusy(true); setRefundError('');
    try {
      const res = await fetch(`${API_BASE}/dashboard/payments/${id}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenStore.get()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: refundAmount || undefined, reason: refundReason || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Refund failed');
      setRefundAmount(''); setRefundReason('');
      await load();
    } catch (e: any) { setRefundError(e.message); }
    finally { setRefundBusy(false); }
  };

  const doConfirm = async () => {
    if (!window.confirm("Mark this payment as paid?\n\nOnly do this after you've confirmed the money arrived in your bank account. This issues loyalty points and fires webhooks, just like an automatic confirmation.")) return;
    setConfirmBusy(true); setConfirmError('');
    try {
      const res = await fetch(`${API_BASE}/dashboard/payments/${id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenStore.get()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Confirm failed');
      await load();
    } catch (e: any) { setConfirmError(e.message); }
    finally { setConfirmBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="h-full w-full max-w-md animate-fade-in overflow-y-auto rounded-l-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Payment details</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
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
            <Row k="Refunded" v={`${data.refunded_amount ?? '0.00'} ${data.currency}`} />
            {data.provider_reference && (
              <Row k="Provider md5" v={<span className="font-mono text-xs">{data.provider_reference.md5}</span>} />
            )}

            {['pending', 'scanned', 'expired'].includes(data.status) && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="mb-1 font-medium text-slate-700">Confirm payment</div>
                <div className="mb-2 text-xs text-slate-500">Received this KHQR payment in your bank? Mark it paid — this issues loyalty points and fires webhooks.</div>
                <div className="flex items-center gap-2">
                  <button onClick={doConfirm} disabled={confirmBusy} className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                    {confirmBusy ? 'Marking…' : 'Mark as paid'}
                  </button>
                  {confirmError && <span className="text-xs text-red-600">{confirmError}</span>}
                </div>
              </div>
            )}

            {(data.status === 'paid') && Number(data.refunded_amount ?? 0) < Number(data.amount) && (
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="mb-2 font-medium text-slate-700">Refund</div>
                <div className="flex gap-2">
                  <input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Amount (blank = full)`} className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason" className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={doRefund} disabled={refundBusy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                    {refundBusy ? 'Refunding…' : 'Issue refund'}
                  </button>
                  {refundError && <span className="text-xs text-red-600">{refundError}</span>}
                </div>
              </div>
            )}

            {data.refunds && data.refunds.length > 0 && (
              <div>
                <div className="mb-2 font-medium text-slate-700">Refunds</div>
                <ul className="space-y-1 text-xs">
                  {data.refunds.map((r: any) => (
                    <li key={r.id} className="flex justify-between border-b border-slate-50 pb-1">
                      <span>{r.amount} {data.currency} <span className="text-slate-400">{r.reason ?? ''}</span></span>
                      <span className="text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
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
