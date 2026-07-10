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
      <PageTitle title="Settings" subtitle="Verification, security, and audit." />
      <VerificationCard orgId={orgId} />
      <MfaCard />
      <AuditCard orgId={orgId} />
    </>
  );
}

function VerificationCard({ orgId }: { orgId?: string }) {
  const [status, setStatus] = useState<string>('loading');
  const [rejection, setRejection] = useState<string | null>(null);
  const [form, setForm] = useState({ legalName: '', businessType: '', registrationNumber: '', contactName: '', contactPhone: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const v = await api<any>(`/verification?org_id=${orgId}`);
    setStatus(v.status);
    setRejection(v.rejection_reason ?? null);
    if (v.legal_name) setForm({ legalName: v.legal_name, businessType: v.business_type, registrationNumber: v.registration_number ?? '', contactName: v.contact_name, contactPhone: v.contact_phone ?? '', address: v.address ?? '' });
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!orgId) return;
    setBusy(true); setMsg('');
    try {
      await api('/verification', { method: 'POST', body: { organizationId: orgId, ...form } });
      setMsg('Submitted for review'); await load();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const badge = { verified: 'text-emerald-600', pending: 'text-amber-600', rejected: 'text-red-600', unverified: 'text-slate-500', loading: 'text-slate-400' }[status] ?? 'text-slate-500';

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Merchant verification (KYC)</h3>
        <span className={`text-sm font-medium capitalize ${badge}`}>{status}</span>
      </div>
      <p className="mb-3 text-sm text-slate-500">Required before activating live mode. {rejection && <span className="text-red-600">Rejected: {rejection}</span>}</p>
      {status !== 'verified' && (
        <div className="grid gap-2 md:grid-cols-2">
          {([['legalName', 'Legal business name'], ['businessType', 'Business type'], ['registrationNumber', 'Registration no. (optional)'], ['contactName', 'Contact name'], ['contactPhone', 'Contact phone (optional)'], ['address', 'Address (optional)']] as const).map(([k, label]) => (
            <label key={k} className="text-sm">
              <div className="mb-1 text-slate-600">{label}</div>
              <input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
          ))}
        </div>
      )}
      {status !== 'verified' && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={submit} disabled={busy || !form.legalName || !form.businessType || !form.contactName}>
            {status === 'pending' ? 'Resubmit' : 'Submit for verification'}
          </Button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      )}
    </Card>
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
