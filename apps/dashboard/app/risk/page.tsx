'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface RiskCase { id: string; payment_id: string | null; customer_id: string | null; score: number; reasons: string[]; status: string; resolution: string | null; created_at: string }
interface Summary { open: number; investigating: number; escalated: number; resolved: number }

export default function RiskPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [cases, setCases] = useState<RiskCase[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setSummary(await api<Summary>(`/dashboard/stores/${storeId}/risk/summary`));
    setCases(await api<RiskCase[]>(`/dashboard/stores/${storeId}/risk/cases${filter ? `?status=${filter}` : ''}`));
  }, [storeId, filter]);
  useEffect(() => { load(); }, [load]);

  const update = async (id: string, status: string) => {
    let resolution: string | undefined;
    if (status === 'RESOLVED') resolution = prompt('Resolution note (optional)') ?? undefined;
    await api(`/dashboard/risk/cases/${id}`, { method: 'PUT', body: { status, resolution } });
    await load();
  };

  const color = (s: string) => s === 'open' ? 'text-red-600' : s === 'escalated' ? 'text-purple-600' : s === 'investigating' ? 'text-amber-600' : 'text-slate-400';
  return (
    <>
      <PageTitle title="Risk & Compliance" subtitle="Automated fraud scoring opens cases on paid payments; review and resolve them here." />
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['open', 'investigating', 'escalated', 'resolved'] as const).map((k) => (
            <button key={k} onClick={() => setFilter(filter === k ? '' : k)} className={`rounded-lg px-3 py-2 text-left ${filter === k ? 'bg-slate-800 text-white' : 'bg-slate-50'}`}>
              <div className="text-xs opacity-70 capitalize">{k}</div>
              <div className="text-lg font-semibold">{summary[k]}</div>
            </button>
          ))}
        </div>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Score</th><th className="px-4 py-3">Reasons</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-b border-slate-50">
                <td className="px-4 py-3"><span className={`font-semibold ${c.score >= 70 ? 'text-red-600' : c.score >= 50 ? 'text-amber-600' : 'text-slate-600'}`}>{c.score}</span></td>
                <td className="px-4 py-3">{c.reasons.map((r) => <span key={r} className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r}</span>)}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.payment_id ?? '—'}</td>
                <td className={`px-4 py-3 capitalize ${color(c.status)}`}>{c.status}</td>
                <td className="px-4 py-3">
                  {c.status !== 'resolved' && (
                    <div className="flex gap-1">
                      {c.status === 'open' && <button onClick={() => update(c.id, 'INVESTIGATING')} className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700">Investigate</button>}
                      <button onClick={() => update(c.id, 'ESCALATED')} className="rounded border border-purple-300 px-2 py-0.5 text-xs text-purple-700">Escalate</button>
                      <button onClick={() => update(c.id, 'RESOLVED')} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700">Resolve</button>
                    </div>
                  )}
                  {c.resolution && <span className="text-xs text-slate-400">{c.resolution}</span>}
                </td>
              </tr>
            ))}
            {cases.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No cases{filter ? ` (${filter})` : ''}. 🎉</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}
