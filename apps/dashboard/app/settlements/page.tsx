'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';

interface Settlement {
  id: string; currency: string; payout_date: string; status: string;
  gross: string; refunds: string; fee: string; net: string; payment_count: number; settled_at: string | null;
}
interface Recon {
  id: string; provider: string; checked: number; matched: number; mismatched: number;
  discrepancies: any[]; created_at: string; period_start: string; period_end: string;
}

export default function SettlementsPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>
      }
    </Shell>
  );
}

function Content({ storeId }: { storeId: string }) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [recons, setRecons] = useState<Recon[]>([]);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      api<Settlement[]>(`/dashboard/stores/${storeId}/settlements`),
      api<Recon[]>(`/dashboard/stores/${storeId}/reconciliations`),
    ]);
    setSettlements(s); setRecons(r);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const settleNow = async () => {
    setBusy('settle');
    try {
      const r = await api<{ created: number }>(`/dashboard/stores/${storeId}/settle`, { method: 'POST' });
      setFlash(`Created ${r.created} settlement batch(es)`); await load();
    } finally { setBusy(''); setTimeout(() => setFlash(''), 2500); }
  };
  const reconcile = async () => {
    setBusy('reconcile');
    try {
      const r = await api<Recon>(`/dashboard/stores/${storeId}/reconcile`, { method: 'POST' });
      setFlash(`Reconciled ${r.checked} payments — ${r.mismatched} discrepancies`); await load();
    } finally { setBusy(''); setTimeout(() => setFlash(''), 3000); }
  };

  return (
    <>
      <PageTitle
        title="Settlements"
        subtitle="Daily payout batches and reconciliation."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reconcile} disabled={!!busy}>{busy === 'reconcile' ? 'Reconciling…' : 'Reconcile'}</Button>
            <Button onClick={settleNow} disabled={!!busy}>{busy === 'settle' ? 'Settling…' : 'Settle now'}</Button>
          </div>
        }
      />
      {flash && <div className="mb-4 text-sm text-emerald-600">{flash}</div>}

      <Card className="mb-6 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Payout date</th><th className="px-4 py-3">Cur</th><th className="px-4 py-3">Payments</th><th className="px-4 py-3">Gross</th><th className="px-4 py-3">Refunds</th><th className="px-4 py-3">Fee</th><th className="px-4 py-3">Net</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody>
            {settlements.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No settlements yet — click “Settle now”.</td></tr>}
            {settlements.map((s) => (
              <tr key={s.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{s.payout_date}</td>
                <td className="px-4 py-3">{s.currency}</td>
                <td className="px-4 py-3">{s.payment_count}</td>
                <td className="px-4 py-3">{s.gross}</td>
                <td className="px-4 py-3 text-slate-500">{s.refunds}</td>
                <td className="px-4 py-3 text-slate-500">{s.fee}</td>
                <td className="px-4 py-3 font-medium">{s.net}</td>
                <td className="px-4 py-3"><StatusBadge status={s.status === 'settled' ? 'paid' : 'pending'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Reconciliation reports</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Checked</th><th className="px-4 py-3">Matched</th><th className="px-4 py-3">Discrepancies</th></tr>
          </thead>
          <tbody>
            {recons.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No reconciliation runs yet.</td></tr>}
            {recons.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">{r.provider}</td>
                <td className="px-4 py-3">{r.checked}</td>
                <td className="px-4 py-3 text-emerald-600">{r.matched}</td>
                <td className="px-4 py-3">{r.mismatched === 0 ? <span className="text-emerald-600">none</span> : <span className="text-red-600">{r.mismatched}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
