'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Game { id: string; name: string; type: string; active: boolean; auto_issue: boolean; min_payment_amount: string | null; prize_count: number; play_count: number }
interface Prize { id: string; label: string; type: string; points_value: number; weight: number; stock: number; remaining: number | null; awarded: number; probability: number }
interface GameDetail extends Game { store_id: string; prizes: Prize[] }

export default function GamesPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [games, setGames] = useState<Game[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('SCRATCH_CARD');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setGames(await api<Game[]>(`/dashboard/stores/${storeId}/games`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name) return;
    const g = await api<GameDetail>(`/dashboard/stores/${storeId}/games`, { method: 'POST', body: { name, type } });
    setName(''); await load(); setOpenId(g.id);
  };

  return (
    <>
      <PageTitle title="Games" subtitle="Promotional games — a weighted prize engine with inventory. Customers play to win points or rewards." />
      <Card className="mb-6">
        <h3 className="mb-3 font-semibold">New game</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm"><div className="mb-1 text-slate-600">Name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucky Scratch" className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          <label className="text-sm"><div className="mb-1 text-slate-600">Type</div>
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="SCRATCH_CARD">Scratch card</option>
              <option value="SPIN_WHEEL">Spin wheel</option>
              <option value="LUCKY_DRAW">Lucky draw</option>
            </select></label>
          <Button onClick={create}>Create</Button>
        </div>
      </Card>

      <div className="space-y-3">
        {games.map((g) => (
          <GameRow key={g.id} game={g} storeId={storeId} open={openId === g.id} onToggle={() => setOpenId(openId === g.id ? null : g.id)} onChange={load} />
        ))}
        {games.length === 0 && <Card className="text-slate-500">No games yet. Create one above.</Card>}
      </div>
    </>
  );
}

function GameRow({ game, open, onToggle, onChange }: { game: Game; storeId: string; open: boolean; onToggle: () => void; onChange: () => void }) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [label, setLabel] = useState('');
  const [ptype, setPtype] = useState('POINTS');
  const [pts, setPts] = useState('100');
  const [weight, setWeight] = useState('1');
  const [stock, setStock] = useState('-1');

  const loadDetail = useCallback(async () => { setDetail(await api<GameDetail>(`/dashboard/games/${game.id}`)); }, [game.id]);
  useEffect(() => { if (open) loadDetail(); }, [open, loadDetail]);

  const toggleActive = async () => { await api(`/dashboard/games/${game.id}`, { method: 'PUT', body: { active: !game.active } }); onChange(); };
  const setAutoIssue = async (v: boolean) => { await api(`/dashboard/games/${game.id}`, { method: 'PUT', body: { autoIssue: v } }); onChange(); await loadDetail(); };
  const del = async () => { if (!confirm('Delete game?')) return; await api(`/dashboard/games/${game.id}`, { method: 'DELETE' }); onChange(); };
  const addPrize = async () => {
    if (!label) return;
    await api(`/dashboard/games/${game.id}/prizes`, { method: 'POST', body: { label, type: ptype, pointsValue: ptype === 'POINTS' ? Number(pts) : 0, weight: Number(weight), stock: Number(stock) } });
    setLabel(''); await loadDetail();
  };
  const delPrize = async (id: string) => { await api(`/dashboard/prizes/${id}`, { method: 'DELETE' }); await loadDetail(); };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <button onClick={onToggle} className="flex items-center gap-3 text-left">
          <span className="text-lg">{open ? '▾' : '▸'}</span>
          <span>
            <span className="font-semibold">{game.name}</span>
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{game.type.replace('_', ' ')}</span>
            <span className="ml-2 text-xs text-slate-400">{game.prize_count} prizes · {game.play_count} plays</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={toggleActive} className={`rounded-md px-2 py-1 text-xs ${game.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{game.active ? 'Active' : 'Inactive'}</button>
          <button onClick={del} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
        </div>
      </div>

      {open && detail && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={detail.auto_issue} onChange={(e) => setAutoIssue(e.target.checked)} />
            Auto-issue a play on each paid payment (scratch card)
          </label>

          <div className="mb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Prize</th><th>Type</th><th>Weight</th><th>Odds</th><th>Stock</th><th>Awarded</th><th></th></tr></thead>
              <tbody>
                {detail.prizes.map((p) => (
                  <tr key={p.id} className="border-t border-slate-50">
                    <td className="py-1.5">{p.label}</td>
                    <td>{p.type}{p.type === 'points' ? ` (${p.points_value})` : ''}</td>
                    <td>{p.weight}</td>
                    <td>{Math.round(p.probability * 100)}%</td>
                    <td>{p.remaining === null ? '∞' : p.remaining}</td>
                    <td>{p.awarded}</td>
                    <td><button onClick={() => delPrize(p.id)} className="text-xs text-red-500 hover:underline">remove</button></td>
                  </tr>
                ))}
                {detail.prizes.length === 0 && <tr><td colSpan={7} className="py-2 text-slate-400">No prizes — add one below (include a NONE prize for “no win”).</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Label</div><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="10% off" className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
            <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Type</div>
              <select value={ptype} onChange={(e) => setPtype(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                <option value="POINTS">Points</option>
                <option value="REWARD">Reward</option>
                <option value="CUSTOM">Custom</option>
                <option value="NONE">No win</option>
              </select></label>
            {ptype === 'POINTS' && <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Points</div><input value={pts} onChange={(e) => setPts(e.target.value)} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>}
            <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Weight</div><input value={weight} onChange={(e) => setWeight(e.target.value)} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
            <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Stock (−1=∞)</div><input value={stock} onChange={(e) => setStock(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
            <Button onClick={addPrize}>Add prize</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
