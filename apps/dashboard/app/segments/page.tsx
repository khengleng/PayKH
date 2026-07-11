'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Segment { id: string; name: string; description: string | null; rules: any; created_at: string }

const FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'min_lifetime_points', label: 'Min lifetime points', placeholder: 'e.g. 100' },
  { key: 'min_points_balance', label: 'Min points balance', placeholder: 'e.g. 50' },
  { key: 'tier_id', label: 'Tier id', placeholder: 'tier_…' },
  { key: 'min_paid_count', label: 'Min paid payments', placeholder: 'e.g. 3' },
  { key: 'min_paid_volume', label: 'Min paid volume ($)', placeholder: 'e.g. 100' },
  { key: 'last_payment_within_days', label: 'Last payment within (days)', placeholder: 'e.g. 30' },
];

export default function SegmentsPage() {
  return (
    <Shell>
      {({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}
    </Shell>
  );
}

function Content({ storeId }: { storeId: string }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState('');
  const [rules, setRules] = useState<Record<string, string>>({});
  const [hasEmail, setHasEmail] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [samples, setSamples] = useState<Record<string, { count: number; sample: any[] }>>({});

  const load = useCallback(async () => setSegments(await api<Segment[]>(`/dashboard/stores/${storeId}/segments`)), [storeId]);
  useEffect(() => { load(); }, [load]);

  const buildRules = () => {
    const r: any = {};
    for (const [k, v] of Object.entries(rules)) {
      if (v === '') continue;
      r[k] = k === 'tier_id' ? v : Number(v);
    }
    if (hasEmail) r.has_email = true;
    return r;
  };

  const runPreview = async () => {
    const res = await api<{ count: number }>(`/dashboard/stores/${storeId}/segments/preview`, { method: 'POST', body: { rules: buildRules() } });
    setPreview(res.count);
  };
  const create = async () => {
    await api(`/dashboard/stores/${storeId}/segments`, { method: 'POST', body: { name, rules: buildRules() } });
    setName(''); setRules({}); setHasEmail(false); setPreview(null); await load();
  };
  const previewSaved = async (id: string) => {
    const res = await api<{ count: number; sample: any[] }>(`/dashboard/segments/${id}/preview`);
    setSamples((s) => ({ ...s, [id]: res }));
  };
  const del = async (id: string) => { if (!confirm('Delete segment?')) return; await api(`/dashboard/segments/${id}`, { method: 'DELETE' }); await load(); };

  return (
    <>
      <PageTitle title="Segments" subtitle="Rule-based customer segments for targeting & campaigns." />

      <Card className="mb-6">
        <h3 className="mb-3 font-semibold">New segment</h3>
        <label className="mb-3 block text-sm"><div className="mb-1 text-slate-600">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="High spenders" className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <div className="grid gap-3 md:grid-cols-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-sm"><div className="mb-1 text-slate-600">{f.label}</div>
              <input value={rules[f.key] ?? ''} onChange={(e) => setRules({ ...rules, [f.key]: e.target.value })} placeholder={f.placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
          ))}
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} /> Has email</label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" onClick={runPreview}>Preview size</Button>
          <Button onClick={create} disabled={!name}>Save segment</Button>
          {preview !== null && <span className="text-sm text-slate-600">Matches: <b>{preview}</b> customers</span>}
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Segment</th><th className="px-4 py-3">Rules</th><th className="px-4 py-3">Size</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {segments.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No segments yet.</td></tr>}
            {segments.map((s) => (
              <tr key={s.id} className="border-b border-slate-50 align-top">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3"><code className="text-xs text-slate-500">{JSON.stringify(s.rules)}</code></td>
                <td className="px-4 py-3">{samples[s.id] ? <b>{samples[s.id].count}</b> : <button onClick={() => previewSaved(s.id)} className="text-brand-600 hover:underline">Evaluate</button>}</td>
                <td className="px-4 py-3 text-right"><button onClick={() => del(s.id)} className="text-red-600 hover:underline">Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
