'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { ApiKey } from '@/lib/types';

export default function KeysPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? (
          <KeysContent storeId={activeStore.id} />
        ) : (
          <Card className="text-slate-600">Create a store first.</Card>
        )
      }
    </Shell>
  );
}

function KeysContent({ storeId }: { storeId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [label, setLabel] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await api<ApiKey[]>(`/api-keys?store_id=${storeId}`);
    setKeys(list);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const key = await api<ApiKey>('/api-keys', {
        method: 'POST',
        body: { storeId, mode, label: label || undefined },
      });
      setRevealed(key.secret ?? null);
      setLabel('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Applications using it will stop working.')) return;
    await api(`/api-keys/${id}/revoke`, { method: 'POST' });
    await load();
  };

  const rotate = async (id: string) => {
    if (!confirm('Rotate this key? The old key is revoked and a new secret is issued.')) return;
    const key = await api<ApiKey>(`/api-keys/${id}/rotate`, { method: 'POST' });
    setRevealed(key.secret ?? null);
    await load();
  };

  return (
    <>
      <PageTitle title="API Keys" subtitle="Secrets are shown once at creation and stored hashed." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Mode</div>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')} className="rounded-lg border border-slate-200 px-3 py-2">
              <option value="test">Test (bk_test_)</option>
              <option value="live">Live (bk_live_)</option>
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Label</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Server key" className="rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <Button onClick={create} disabled={busy}>Create key</Button>
        </div>
      </Card>

      {revealed && (
        <Card className="mb-4 border border-emerald-200 bg-emerald-50">
          <div className="text-sm font-medium text-emerald-800">Copy your new secret now — it won’t be shown again.</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm">{revealed}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(revealed)}>Copy</Button>
            <Button variant="secondary" onClick={() => setRevealed(null)}>Done</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Last used</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{k.display_prefix}…{k.last4}</td>
                <td className="px-4 py-3">{k.mode}</td>
                <td className="px-4 py-3 text-slate-600">{k.label ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
                <td className="px-4 py-3">
                  {k.revoked ? <span className="text-red-500">revoked</span> : <span className="text-emerald-600">active</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {!k.revoked && (
                    <div className="flex justify-end gap-2">
                      <button onClick={() => rotate(k.id)} className="text-brand-600 hover:underline">Rotate</button>
                      <button onClick={() => revoke(k.id)} className="text-red-600 hover:underline">Revoke</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No API keys yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
