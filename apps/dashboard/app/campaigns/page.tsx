'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';

interface Promo { id: string; name: string; type: string; status: string; segment_id: string | null; config: any; budget_points: number | null; spent_points: number; start_at: string | null; end_at: string | null }
interface Segment { id: string; name: string }

export default function CampaignsPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('POINTS_MULTIPLIER');
  const [segmentId, setSegmentId] = useState('');
  const [multiplier, setMultiplier] = useState('2');
  const [bonusPoints, setBonusPoints] = useState('50');
  const [minAmount, setMinAmount] = useState('');
  const [budget, setBudget] = useState('');
  const [end, setEnd] = useState('');

  const load = useCallback(async () => {
    setPromos(await api<Promo[]>(`/dashboard/stores/${storeId}/promotions`));
    setSegments(await api<Segment[]>(`/dashboard/stores/${storeId}/segments`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const config: any = type === 'POINTS_MULTIPLIER' ? { multiplier: Number(multiplier) } : { bonusPoints: Number(bonusPoints) };
    if (minAmount) config.minAmount = Number(minAmount);
    await api(`/dashboard/stores/${storeId}/promotions`, { method: 'POST', body: {
      name, type, segmentId: segmentId || undefined, config,
      budgetPoints: budget ? Number(budget) : undefined,
      endAt: end ? new Date(end).toISOString() : undefined,
    } });
    setName(''); await load();
  };
  const act = async (id: string, action: string) => { await api(`/dashboard/promotions/${id}/${action}`, { method: 'POST' }); await load(); };
  const del = async (id: string) => { if (!confirm('Delete promotion?')) return; await api(`/dashboard/promotions/${id}`, { method: 'DELETE' }); await load(); };

  return (
    <>
      <PageTitle title="Campaigns" subtitle="Promotions award bonus loyalty points to a target segment on paid payments." />
      <Card className="mb-6">
        <h3 className="mb-3 font-semibold">New promotion</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm"><div className="mb-1 text-slate-600">Name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Double points week" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          <label className="text-sm"><div className="mb-1 text-slate-600">Type</div>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="POINTS_MULTIPLIER">Points multiplier</option>
              <option value="BONUS_POINTS">Flat bonus points</option>
            </select></label>
          <label className="text-sm"><div className="mb-1 text-slate-600">Target segment</div>
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">All customers</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          {type === 'POINTS_MULTIPLIER'
            ? <label className="text-sm"><div className="mb-1 text-slate-600">Multiplier (×)</div><input value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            : <label className="text-sm"><div className="mb-1 text-slate-600">Bonus points</div><input value={bonusPoints} onChange={(e) => setBonusPoints(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>}
          <label className="text-sm"><div className="mb-1 text-slate-600">Min payment ($, optional)</div><input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          <label className="text-sm"><div className="mb-1 text-slate-600">Budget (points, optional)</div><input value={budget} onChange={(e) => setBudget(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          <label className="text-sm"><div className="mb-1 text-slate-600">Ends (optional)</div><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-4"><Button onClick={create} disabled={!name}>Create (draft)</Button></div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Promotion</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Budget</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {promos.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No promotions yet.</td></tr>}
            {promos.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-medium">{p.name}<div className="text-xs text-slate-400">{JSON.stringify(p.config)}</div></td>
                <td className="px-4 py-3 text-slate-500">{p.type === 'POINTS_MULTIPLIER' ? 'multiplier' : 'bonus'}</td>
                <td className="px-4 py-3 text-slate-500">{p.segment_id ? 'segment' : 'all'}</td>
                <td className="px-4 py-3 text-slate-500">{p.budget_points ? `${p.spent_points}/${p.budget_points}` : '∞'}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status === 'active' ? 'paid' : p.status === 'ended' ? 'failed' : p.status === 'paused' ? 'pending' : 'scanned'} /></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {p.status !== 'active' && p.status !== 'ended' && <button onClick={() => act(p.id, 'activate')} className="text-emerald-600 hover:underline">Activate</button>}
                    {p.status === 'active' && <button onClick={() => act(p.id, 'pause')} className="text-amber-600 hover:underline">Pause</button>}
                    {p.status !== 'ended' && <button onClick={() => act(p.id, 'end')} className="text-slate-600 hover:underline">End</button>}
                    <button onClick={() => del(p.id)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
