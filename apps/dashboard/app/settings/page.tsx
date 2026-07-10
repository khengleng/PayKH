'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface AuditEntry {
  id: string; action: string; entity: string | null; actor_email: string | null;
  ip_address: string | null; at: string;
}

export default function SettingsPage() {
  return <Shell>{({ me }) => <SettingsContent orgId={me.organizations[0]?.id} />}</Shell>;
}

function SettingsContent({ orgId }: { orgId?: string }) {
  return (
    <>
      <PageTitle title="Settings" subtitle="Security and audit." />
      <MfaCard />
      <AuditCard orgId={orgId} />
    </>
  );
}

function MfaCard() {
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');

  const begin = async () => {
    const r = await api<{ secret: string; otpauth_url: string }>('/auth/mfa/setup', { method: 'POST' });
    setSetup(r);
  };
  const enable = async () => {
    try {
      await api('/auth/mfa/enable', { method: 'POST', body: { code } });
      setStatus('MFA enabled ✓'); setSetup(null); setCode('');
    } catch (e: any) { setStatus(e.message); }
  };

  return (
    <Card className="mb-4">
      <h3 className="font-semibold">Two-factor authentication (TOTP)</h3>
      <p className="mb-3 text-sm text-slate-500">Add an authenticator app for stronger account security.</p>
      {!setup ? (
        <Button variant="secondary" onClick={begin}>Set up 2FA</Button>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-slate-600">Add this secret to your authenticator app:</div>
            <code className="mt-1 block break-all rounded bg-slate-50 p-2 font-mono">{setup.secret}</code>
            <div className="mt-1 break-all text-xs text-slate-400">{setup.otpauth_url}</div>
          </div>
          <div className="flex items-end gap-2">
            <label><div className="mb-1 text-slate-600">Enter the 6-digit code</div>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="rounded-lg border border-slate-200 px-3 py-2 font-mono" /></label>
            <Button onClick={enable} disabled={code.length !== 6}>Enable</Button>
          </div>
        </div>
      )}
      {status && <p className="mt-2 text-sm text-emerald-600">{status}</p>}
    </Card>
  );
}

function AuditCard({ orgId }: { orgId?: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await api<{ data: AuditEntry[] }>(`/dashboard/orgs/${orgId}/audit-logs?limit=50`);
      setRows(r.data);
    } catch (e: any) { setError(e.message); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  return (
    <Card className="overflow-x-auto p-0">
      <div className="border-b border-slate-100 px-4 py-3 font-semibold">Audit log</div>
      {error ? <p className="p-4 text-sm text-slate-500">{error}</p> : !rows ? (
        <p className="p-4 text-sm text-slate-400">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">When</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No audit entries</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-3 text-slate-500">{r.entity ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{r.actor_email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{r.ip_address ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(r.at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
