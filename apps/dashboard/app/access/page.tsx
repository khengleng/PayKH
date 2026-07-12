'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Matrix {
  roles: string[];
  permissions: string[];
  matrix: Record<string, Record<string, boolean>>;
  your_role: string | null;
  abac_policies: { id: string; description: string }[];
}

export default function AccessPage() {
  return (
    <Shell>
      {({ me, activeStore }) => {
        const orgId = activeStore?.organization_id ?? me.organizations?.[0]?.id ?? '';
        return orgId ? <Content orgId={orgId} /> : <Card className="text-slate-600">Create a store first.</Card>;
      }}
    </Shell>
  );
}

function Content({ orgId }: { orgId: string }) {
  const [m, setM] = useState<Matrix | null>(null);

  const load = useCallback(async () => {
    setM(await api<Matrix>(`/dashboard/orgs/${orgId}/access/matrix`));
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageTitle title="Access Control" subtitle="Role-based permissions (RBAC) plus attribute-based policies (ABAC) that guard sensitive actions." />
      {m && (
        <>
          <Card className="mb-6 overflow-x-auto">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Role → permission matrix (RBAC)</h3>
              {m.your_role && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">You are: {m.your_role}</span>}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-4">Permission</th>
                  {m.roles.map((r) => <th key={r} className="px-2 py-2 text-center capitalize">{r.replace('_', ' ')}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.permissions.map((p) => (
                  <tr key={p} className="border-t border-slate-50">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-600">{p}</td>
                    {m.roles.map((r) => (
                      <td key={r} className="px-2 py-2 text-center">
                        {m.matrix[r][p]
                          ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-xs text-emerald-600">✓</span>
                          : <span className="text-slate-300">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="mb-6">
            <h3 className="mb-3 font-semibold">Attribute policies (ABAC)</h3>
            <ul className="space-y-2">
              {m.abac_policies.map((p) => (
                <li key={p.id} className="flex gap-3 rounded-lg border border-slate-100 p-3 text-sm">
                  <span className="mt-0.5 text-brand-500">🛡️</span>
                  <div>
                    <div className="font-mono text-xs text-slate-500">{p.id}</div>
                    <div className="text-slate-700">{p.description}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <PolicySimulator orgId={orgId} />
        </>
      )}
    </>
  );
}

function PolicySimulator({ orgId }: { orgId: string }) {
  const [action, setAction] = useState('payment:refund');
  const [amount, setAmount] = useState('1000');
  const [live, setLive] = useState(true);
  const [mode, setMode] = useState('live');
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    const resource = action === 'apikey:create' ? { mode } : { amount: Number(amount), storeLiveMode: live };
    setResult(await api(`/dashboard/orgs/${orgId}/access/check`, { method: 'POST', body: { action, resource } }));
  };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Policy simulator</h3>
      <p className="mb-3 text-sm text-slate-500">Check whether you’d be allowed to perform an action given its attributes.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Action</div>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="payment:refund">payment:refund</option>
            <option value="apikey:create">apikey:create</option>
            <option value="store:write">store:write</option>
          </select></label>
        {action === 'apikey:create' ? (
          <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Key mode</div>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option>live</option><option>test</option></select></label>
        ) : (
          <>
            <label className="text-sm"><div className="mb-1 text-xs text-slate-600">Amount $</div><input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live store</label>
          </>
        )}
        <Button onClick={run}>Evaluate</Button>
      </div>
      {result && (
        <div className={`mt-4 rounded-lg border p-3 text-sm ${result.allow ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <div className="font-semibold">{result.allow ? '✅ Allowed' : '⛔ Denied'} <span className="font-normal opacity-70">(role: {result.role})</span></div>
          {!result.allow && <div className="mt-1">{result.reason} <span className="font-mono text-xs opacity-60">[{result.policy}]</span></div>}
        </div>
      )}
    </Card>
  );
}
