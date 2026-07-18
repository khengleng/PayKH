'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Loyalty program management: the earn rule, the rewards catalogue, tiers, and
 * the redemption queue. This is the one place a merchant turns points on and
 * decides what they are worth — the API for all of this already existed but had
 * no UI, so points could only be configured by hand.
 */
export default function LoyaltyPage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

interface Program { store_id: string; active: boolean; points_per_unit: string; expiry_months: number | null }
interface Reward { id: string; name: string; description: string | null; points_cost: number; stock: number; active: boolean }
interface Tier { id: string; name: string; threshold: number; earn_multiplier: string }
interface Redemption { id: string; reward_name: string | null; points_spent: number; code: string; status: string; created_at: string; customer_name: string | null; customer_email: string | null }
interface ExpiryPreview {
  months: number;
  expires_immediately: { customers: number; points: number };
  expires_within_warn_window: { customers: number; points: number; warn_days: number };
}

function Content({ storeId }: { storeId: string }) {
  return (
    <>
      <PageTitle title="Loyalty" subtitle="Turn paid sales into points, decide what points are worth, and manage what customers can redeem them for." />
      <ProgramCard storeId={storeId} />
      <RewardsCard storeId={storeId} />
      <TiersCard storeId={storeId} />
      <RedemptionsCard storeId={storeId} />
    </>
  );
}

/* ------------------------------------------------------------------ program */

function ProgramCard({ storeId }: { storeId: string }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [active, setActive] = useState(false);
  const [pointsPerUnit, setPointsPerUnit] = useState('1');
  const [expiryMonths, setExpiryMonths] = useState<string>(''); // '' = never
  const [preview, setPreview] = useState<ExpiryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const p = await api<Program>(`/dashboard/stores/${storeId}/loyalty`);
    setProgram(p);
    setActive(p.active);
    setPointsPerUnit(p.points_per_unit);
    setExpiryMonths(p.expiry_months == null ? '' : String(p.expiry_months));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  // Dry-run how many customers/points a chosen expiry window would remove today,
  // so enabling expiry is never a blind switch.
  useEffect(() => {
    if (!expiryMonths || !active) { setPreview(null); return; }
    let cancelled = false;
    api<ExpiryPreview>(`/dashboard/stores/${storeId}/loyalty/expiry-preview?months=${Number(expiryMonths)}`)
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [storeId, expiryMonths, active]);

  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api(`/dashboard/stores/${storeId}/loyalty`, {
        method: 'PUT',
        body: {
          active,
          pointsPerUnit: pointsPerUnit || '1',
          expiryMonths: expiryMonths ? Number(expiryMonths) : null,
        },
      });
      setMsg('Saved.');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!program) return <Card className="mb-6 text-slate-400">Loading program…</Card>;

  const dirty = active !== program.active || pointsPerUnit !== program.points_per_unit || (expiryMonths ? Number(expiryMonths) : null) !== program.expiry_months;

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Program</h3>
        <StatusBadge status={active ? 'active' : 'inactive'} />
      </div>

      <label className="mb-4 flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => setActive((a) => !a)}
          className={`relative h-6 w-11 rounded-full transition ${active ? 'bg-brand-500' : 'bg-slate-200'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${active ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className="text-sm text-slate-700">Award points on paid sales</span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Points per currency unit</label>
          <input
            value={pointsPerUnit}
            onChange={(e) => setPointsPerUnit(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">e.g. <span className="font-medium">1</span> = one point per 1 KHR/USD spent. Fractions allowed (0.01).</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Points expire after</label>
          <select value={expiryMonths} onChange={(e) => setExpiryMonths(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Never</option>
            {[3, 6, 12, 18, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}
          </select>
          {preview && (
            <p className="mt-1 text-xs text-amber-600">
              Applying this today would expire <span className="font-medium">{preview.expires_immediately.points.toLocaleString()}</span> points across <span className="font-medium">{preview.expires_immediately.customers}</span> customer(s)
              {preview.expires_within_warn_window.points > 0 && (
                <>; another <span className="font-medium">{preview.expires_within_warn_window.points.toLocaleString()}</span> expire within {preview.expires_within_warn_window.warn_days} days</>
              )}.
            </p>
          )}
          {expiryMonths && !preview && <p className="mt-1 text-xs text-slate-500">Points unused for this long roll off, oldest first.</p>}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save program'}</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ rewards */

function RewardsCard({ storeId }: { storeId: string }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointsCost, setPointsCost] = useState('');
  const [stock, setStock] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setRewards(await api<Reward[]>(`/dashboard/stores/${storeId}/rewards`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || !pointsCost) return;
    setBusy(true); setErr('');
    try {
      await api(`/dashboard/stores/${storeId}/rewards`, {
        method: 'POST',
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          pointsCost: Number(pointsCost),
          stock: stock === '' ? -1 : Number(stock),
        },
      });
      setName(''); setDescription(''); setPointsCost(''); setStock('');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggle = async (r: Reward) => { await api(`/dashboard/rewards/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); await load(); };
  const del = async (r: Reward) => { if (!confirm(`Delete "${r.name}"?`)) return; await api(`/dashboard/rewards/${r.id}`, { method: 'DELETE' }); await load(); };

  return (
    <Card className="mb-6">
      <h3 className="mb-1 font-semibold">Rewards catalogue</h3>
      <p className="mb-4 text-sm text-slate-500">What customers can redeem their points for. Set stock to blank for unlimited.</p>

      <div className="mb-5 grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Reward</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Free coffee" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Points cost</label>
          <input value={pointsCost} onChange={(e) => setPointsCost(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="500" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Stock (blank = ∞)</label>
          <input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="∞" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <Button onClick={create} disabled={busy || !name.trim() || !pointsCost}>Add</Button>
      </div>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {rewards.length === 0 ? (
        <p className="text-sm text-slate-400">No rewards yet — add one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Reward</th>
                <th className="pb-2">Points</th>
                <th className="pb-2">Stock</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rewards.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
                  </td>
                  <td className="py-2.5 tabular-nums">{r.points_cost.toLocaleString()}</td>
                  <td className="py-2.5 tabular-nums">{r.stock < 0 ? '∞' : r.stock}</td>
                  <td className="py-2.5"><StatusBadge status={r.active ? 'active' : 'inactive'} /></td>
                  <td className="py-2.5 text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => toggle(r)}>{r.active ? 'Deactivate' : 'Activate'}</Button>
                      <Button size="sm" variant="danger" onClick={() => del(r)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------- tiers */

function TiersCard({ storeId }: { storeId: string }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setTiers(await api<Tier[]>(`/dashboard/stores/${storeId}/tiers`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try {
      await api(`/dashboard/stores/${storeId}/tiers`, {
        method: 'POST',
        body: { name: name.trim(), threshold: Number(threshold || 0), earnMultiplier: multiplier || '1' },
      });
      setName(''); setThreshold(''); setMultiplier('1');
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const del = async (t: Tier) => { if (!confirm(`Delete tier "${t.name}"?`)) return; await api(`/dashboard/tiers/${t.id}`, { method: 'DELETE' }); await load(); };

  return (
    <Card className="mb-6">
      <h3 className="mb-1 font-semibold">Tiers</h3>
      <p className="mb-4 text-sm text-slate-500">Reward loyal spenders: once a customer’s lifetime points cross a threshold, they earn at a higher multiplier.</p>

      <div className="mb-5 grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tier name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Points threshold</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="10000" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Earn multiplier</label>
          <input value={multiplier} onChange={(e) => setMultiplier(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="1.5" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <Button onClick={create} disabled={busy || !name.trim()}>Add</Button>
      </div>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}

      {tiers.length === 0 ? (
        <p className="text-sm text-slate-400">No tiers — everyone earns at the base rate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Tier</th>
                <th className="pb-2">From (points)</th>
                <th className="pb-2">Earn ×</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td className="py-2.5 font-medium text-slate-800">{t.name}</td>
                  <td className="py-2.5 tabular-nums">{t.threshold.toLocaleString()}</td>
                  <td className="py-2.5 tabular-nums">×{t.earn_multiplier}</td>
                  <td className="py-2.5 text-right"><Button size="sm" variant="danger" onClick={() => del(t)}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- redemptions */

function RedemptionsCard({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Redemption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setRows(await api<Redemption[]>(`/dashboard/stores/${storeId}/redemptions`));
    setLoaded(true);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'fulfill' | 'cancel') => {
    if (action === 'cancel' && !confirm('Cancel this redemption? Points are refunded and stock restored.')) return;
    await api(`/dashboard/redemptions/${id}/${action}`, { method: 'POST' });
    await load();
  };

  return (
    <Card className="mb-6">
      <h3 className="mb-1 font-semibold">Redemptions</h3>
      <p className="mb-4 text-sm text-slate-500">When a customer redeems points for a reward, fulfil it here once you’ve handed it over.</p>

      {!loaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No redemptions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Reward</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Points</th>
                <th className="pb-2">Code</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 font-medium text-slate-800">{r.reward_name ?? '—'}</td>
                  <td className="py-2.5">
                    <div className="text-slate-700">{r.customer_name ?? '—'}</div>
                    {r.customer_email && <div className="text-xs text-slate-400">{r.customer_email}</div>}
                  </td>
                  <td className="py-2.5 tabular-nums">{r.points_spent.toLocaleString()}</td>
                  <td className="py-2.5 font-mono text-xs text-slate-600">{r.code}</td>
                  <td className="py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="py-2.5 text-right">
                    {r.status === 'issued' ? (
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => act(r.id, 'fulfill')}>Fulfil</Button>
                        <Button size="sm" variant="danger" onClick={() => act(r.id, 'cancel')}>Cancel</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
