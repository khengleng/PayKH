'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface App { type: string; name: string; category: string; description: string; setup: string; builtin?: boolean }
interface Connector { id: string; type: string; target_url_masked: string; enabled: boolean; enabled_events: string[] }

export default function MarketplacePage() {
  return <Shell>{({ activeStore }) => (activeStore ? <Content storeId={activeStore.id} /> : <Card className="text-slate-600">Create a store first.</Card>)}</Shell>;
}

function Content({ storeId }: { storeId: string }) {
  const [apps, setApps] = useState<App[]>([]);
  const [installed, setInstalled] = useState<Connector[]>([]);
  const [url, setUrl] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setApps((await api<{ apps: App[] }>('/dashboard/marketplace')).apps);
    setInstalled(await api<Connector[]>(`/dashboard/stores/${storeId}/connectors`));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const install = async (type: string) => {
    const targetUrl = url[type];
    if (!targetUrl) return;
    await api(`/dashboard/stores/${storeId}/connectors`, { method: 'POST', body: { type, targetUrl } });
    setUrl((u) => ({ ...u, [type]: '' })); await load();
  };
  const test = async (id: string) => { const r = await api<{ sent: boolean }>(`/dashboard/connectors/${id}/test`, { method: 'POST' }); setMsg(r.sent ? 'Test sent ✓' : 'Test failed'); setTimeout(() => setMsg(''), 2000); };
  const remove = async (id: string) => { await api(`/dashboard/connectors/${id}`, { method: 'DELETE' }); await load(); };

  return (
    <>
      <PageTitle title="App Marketplace" subtitle="Connect PayKH to the tools you already use. Connectors receive payment events (fire-and-forget)." />
      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}

      {installed.length > 0 && (
        <Card className="mb-6">
          <h3 className="mb-2 font-semibold">Installed</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {installed.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="capitalize">{c.type} <span className="ml-2 font-mono text-xs text-slate-400">{c.target_url_masked}</span></span>
                <span className="flex gap-2">
                  <button onClick={() => test(c.id)} className="rounded border border-slate-200 px-2 py-0.5 text-xs">Test</button>
                  <button onClick={() => remove(c.id)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600">Remove</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {apps.map((a) => (
          <Card key={a.type}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{a.name}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{a.category}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{a.description}</p>
            {a.builtin ? (
              <p className="mt-3 text-xs text-slate-400">{a.setup}</p>
            ) : (
              <div className="mt-3 flex gap-2">
                <input value={url[a.type] ?? ''} onChange={(e) => setUrl((u) => ({ ...u, [a.type]: e.target.value }))} placeholder={a.setup} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <Button onClick={() => install(a.type)}>Install</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
