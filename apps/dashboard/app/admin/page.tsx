'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import { Button, Card, Stat, StatusBadge } from '@/components/ui';

interface Org { id: string; name: string; status: string; plan: string; members: number; stores: number; month_paid: number }
interface Metrics { organizations: number; suspended: number; stores: number; total_payments: number; paid_count: number; paid_volume: string; success_rate: number }

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [email, setEmail] = useState('');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [verifs, setVerifs] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    const [m, o, v] = await Promise.all([
      api<Metrics>('/admin/metrics'),
      api<Org[]>(`/admin/orgs${search ? `?search=${encodeURIComponent(search)}` : ''}`),
      api<any[]>('/admin/verifications'),
    ]);
    setMetrics(m); setOrgs(o); setVerifs(v);
  }, [search]);

  const reviewVerif = async (orgId: string, approve: boolean) => {
    if (!approve) {
      const reason = prompt('Rejection reason?') || 'Not specified';
      await api(`/admin/verifications/${orgId}/reject`, { method: 'POST', body: { reason } });
    } else {
      await api(`/admin/verifications/${orgId}/approve`, { method: 'POST' });
    }
    await loadData();
  };

  useEffect(() => {
    if (!tokenStore.get()) { router.replace('/login?next=/admin'); return; }
    (async () => {
      try {
        const me = await api<{ is_platform_admin: boolean; email: string }>('/admin/me');
        setEmail(me.email);
        if (me.is_platform_admin) { setAllowed(true); await loadData(); }
      } catch { /* not admin */ }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suspend = async (id: string, on: boolean) => {
    await api(`/admin/orgs/${id}/${on ? 'suspend' : 'reactivate'}`, { method: 'POST' });
    await loadData();
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  if (!allowed) return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <p className="mt-2 text-sm text-slate-500">{email || 'This account'} is not a platform admin.</p>
        <div className="mt-4"><Button variant="secondary" onClick={() => router.replace('/overview')}>Back to dashboard</Button></div>
      </Card>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform Admin</h1>
          <p className="text-sm text-slate-500">{email}</p>
        </div>
        <Button variant="secondary" onClick={() => { tokenStore.clear(); router.replace('/login'); }}>Sign out</Button>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Merchants" value={metrics.organizations} hint={`${metrics.suspended} suspended`} />
          <Stat label="Stores" value={metrics.stores} />
          <Stat label="Payments" value={metrics.total_payments} hint={`${metrics.success_rate}% success`} />
          <Stat label="Paid volume" value={`$${metrics.paid_volume}`} />
        </div>
      )}

      <SupportConsole />
      <SystemSettings />

      {verifs.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-semibold">Verifications pending review ({verifs.length})</h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-slate-500">
                <tr><th className="px-4 py-3">Organization</th><th className="px-4 py-3">Legal name</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {verifs.map((v) => (
                  <tr key={v.organization_id} className="border-b border-slate-50">
                    <td className="px-4 py-3">{v.organization_name}</td>
                    <td className="px-4 py-3">{v.legal_name}</td>
                    <td className="px-4 py-3 text-slate-500">{v.business_type}</td>
                    <td className="px-4 py-3 text-slate-500">{v.contact_name}{v.contact_phone ? ` · ${v.contact_phone}` : ''}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => reviewVerif(v.organization_id, true)} className="text-emerald-600 hover:underline">Approve</button>
                        <button onClick={() => reviewVerif(v.organization_id, false)} className="text-red-600 hover:underline">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <div className="mb-3 mt-6 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Merchants</h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
        <Button variant="secondary" onClick={loadData}>Search</Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Organization</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Members</th><th className="px-4 py-3">Stores</th><th className="px-4 py-3">Paid (mo)</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-slate-50">
                <td className="px-4 py-3">{o.name}<div className="font-mono text-[10px] text-slate-400">{o.id}</div></td>
                <td className="px-4 py-3">{o.plan}</td>
                <td className="px-4 py-3">{o.members}</td>
                <td className="px-4 py-3">{o.stores}</td>
                <td className="px-4 py-3">{o.month_paid}</td>
                <td className="px-4 py-3">{o.status === 'suspended' ? <StatusBadge status="failed" /> : <StatusBadge status="paid" />}</td>
                <td className="px-4 py-3 text-right">
                  {o.status === 'suspended'
                    ? <button onClick={() => suspend(o.id, false)} className="text-emerald-600 hover:underline">Reactivate</button>
                    : <button onClick={() => suspend(o.id, true)} className="text-red-600 hover:underline">Suspend</button>}
                </td>
              </tr>
            ))}
            {orgs.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No merchants</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

interface Queue { name: string; waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number; paused?: number; healthy: boolean; error?: string }

function SupportConsole() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ queues: Queue[] }>('/admin/queues').then((d) => setQueues(d.queues)).catch(() => {}); }, []);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setRes(await api<any>(`/admin/support/search?q=${encodeURIComponent(q.trim())}`)); } catch { setRes(null); }
    setBusy(false);
  };

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-semibold">Queue monitor</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-2">
        {queues.map((qq) => (
          <Card key={qq.name}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{qq.name}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${qq.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
            {qq.error ? <p className="mt-1 text-xs text-red-500">{qq.error}</p> : (
              <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
                <span>waiting <b>{qq.waiting ?? 0}</b></span>
                <span>active <b>{qq.active ?? 0}</b></span>
                <span>delayed <b>{qq.delayed ?? 0}</b></span>
                <span className={((qq.failed ?? 0) > 0) ? 'text-red-500' : ''}>failed <b>{qq.failed ?? 0}</b></span>
                <span>done <b>{qq.completed ?? 0}</b></span>
              </div>
            )}
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-semibold">Support lookup</h2>
      <Card className="mb-6">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="payment id, reference, customer email/phone, store or org name…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <Button onClick={run} disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button>
        </div>
        {res && (
          <div className="mt-4 space-y-3 text-sm">
            {(['payments', 'customers', 'stores', 'organizations'] as const).map((k) => res[k]?.length > 0 && (
              <div key={k}>
                <div className="mb-1 font-medium capitalize text-slate-600">{k}</div>
                <ul className="divide-y divide-slate-100">
                  {res[k].map((row: any) => (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span className="font-mono text-xs">{row.id}</span>
                      <span className="text-slate-600">{row.name ?? row.email ?? row.reference_id ?? ''} {row.amount ? `· ${row.amount} ${row.currency}` : ''} {row.status ? `· ${row.status}` : ''} {row.live_mode !== undefined ? (row.live_mode ? '· live' : '· test') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(['payments', 'customers', 'stores', 'organizations'] as const).every((k) => !res[k]?.length) && <p className="text-slate-400">No matches.</p>}
          </div>
        )}
      </Card>
    </>
  );
}

interface Setting { key: string; label: string; group: string; secret: boolean; configured: boolean; source: string; preview: string | null }

function SystemSettings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const load = () => api<{ settings: Setting[] }>('/admin/settings').then((d) => setSettings(d.settings)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const value = edit[key];
    if (!value) return;
    await api(`/admin/settings/${key}`, { method: 'PUT', body: { value } });
    setEdit((e) => ({ ...e, [key]: '' })); setMsg(`${key} saved`); setTimeout(() => setMsg(''), 2000); await load();
  };
  const clear = async (key: string) => { await api(`/admin/settings/${key}`, { method: 'DELETE' }); await load(); };

  const groups = [...new Set(settings.map((s) => s.group))];
  const badge = (src: string) => src === 'db' ? 'bg-emerald-50 text-emerald-700' : src === 'env' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700';

  return (
    <>
      <h2 className="mb-2 mt-6 text-lg font-semibold">System settings</h2>
      <p className="mb-3 text-sm text-slate-500">Integration keys, encrypted at rest. A saved value overrides the environment variable — no redeploy needed. {msg && <span className="text-emerald-600">· {msg}</span>}</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g}>
            <div className="mb-2 text-sm font-semibold text-slate-700">{g}</div>
            <div className="space-y-3">
              {settings.filter((s) => s.group === g).map((s) => (
                <div key={s.key} className="flex flex-wrap items-center gap-3">
                  <div className="min-w-48 flex-1">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${badge(s.source)}`}>{s.source}</span>
                      {s.preview && <span className="font-mono text-slate-400">{s.preview}</span>}
                    </div>
                  </div>
                  <input
                    type={s.secret ? 'password' : 'text'}
                    value={edit[s.key] ?? ''}
                    onChange={(e) => setEdit((p) => ({ ...p, [s.key]: e.target.value }))}
                    placeholder={s.configured ? 'Replace…' : 'Set value…'}
                    className="w-56 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  />
                  <Button onClick={() => save(s.key)}>Save</Button>
                  {s.source === 'db' && <button onClick={() => clear(s.key)} className="text-xs text-red-500 hover:underline">Clear</button>}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
