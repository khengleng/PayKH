'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';

interface PayChainConfig {
  configured: boolean;
  base_url: string;
  client_id?: string;
  client_secret_preview?: string | null;
  loyalty_asset_id?: string;
  enabled: boolean;
  shadow_mode: boolean;
  last_tested_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_detail?: string | null;
  readiness: {
    ready: boolean;
    checks: {
      configured: { ok: boolean; detail: string };
      credentials_tested: { ok: boolean; detail: string };
      loyalty_asset: { ok: boolean; detail: string };
      webhook: { ok: boolean; detail: string };
    };
  };
}

interface TestResult {
  ok: boolean;
  detail: string;
  latency_ms: number;
}

const DOCS_URL = 'https://developer.paychain.cambobia.com';

/**
 * A tenant's own PayChain connection (wallet-as-a-service).
 *
 * Owner-only, mirroring the API: the client secret moves real value, so the
 * server refuses to show it to any other role. Rather than render a form that
 * would 403 on submit, non-owners see why they cannot edit it.
 */
export function PayChainCard({ orgId, role }: { orgId?: string; role?: string }) {
  const [cfg, setCfg] = useState<PayChainConfig | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ base_url: '', client_id: '', client_secret: '', loyalty_asset_id: '' });
  const [busy, setBusy] = useState<'save' | 'test' | 'disconnect' | 'flag' | null>(null);
  const [msg, setMsg] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);

  // /auth/me serialises the raw Prisma enum ("OWNER"), while the API's own RBAC
  // uses lowercase. Compare case-insensitively rather than pick a side — a
  // strict === 'owner' here hides this card from every real owner.
  const isOwner = role?.toLowerCase() === 'owner';

  const load = useCallback(async () => {
    if (!orgId || !isOwner) return;
    try {
      const c = await api<PayChainConfig>(`/dashboard/orgs/${orgId}/paychain`);
      setCfg(c);
      setForm({
        base_url: c.base_url,
        client_id: c.client_id ?? '',
        client_secret: '', // never populated — the API only ever returns a mask
        loyalty_asset_id: c.loyalty_asset_id ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orgId, isOwner]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!orgId) return;
    setBusy('save');
    setMsg('');
    setTest(null);
    try {
      await api(`/dashboard/orgs/${orgId}/paychain`, {
        method: 'PUT',
        body: {
          base_url: form.base_url || undefined,
          client_id: form.client_id,
          // Omitted when blank, so editing the asset id does not require
          // re-entering a secret the owner cannot read back.
          ...(form.client_secret ? { client_secret: form.client_secret } : {}),
          loyalty_asset_id: form.loyalty_asset_id || undefined,
        },
      });
      setForm((f) => ({ ...f, client_secret: '' }));
      setMsg('Saved');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    if (!orgId) return;
    setBusy('test');
    setMsg('');
    try {
      setTest(await api<TestResult>(`/dashboard/orgs/${orgId}/paychain/test`, { method: 'POST' }));
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!orgId) return;
    if (!confirm('Disconnect PayChain? This also turns off point issuance to PayChain for this organization.')) return;
    setBusy('disconnect');
    setMsg('');
    setTest(null);
    try {
      await api(`/dashboard/orgs/${orgId}/paychain`, { method: 'DELETE' });
      setForm({ base_url: '', client_id: '', client_secret: '', loyalty_asset_id: '' });
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setFlag = async (key: string, enabled: boolean) => {
    if (!orgId) return;
    setBusy('flag');
    setMsg('');
    try {
      await api(`/dashboard/orgs/${orgId}/feature-flags/${key}`, { method: 'PUT', body: { enabled } });
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!isOwner) {
    return (
      <Card className="mb-4">
        <h3 className="font-semibold">PayChain (wallet-as-a-service)</h3>
        <p className="mt-1 text-sm text-slate-500">
          Only an organization owner can view or change the PayChain connection, because it holds credentials that move
          real value. Your role is <span className="font-medium">{role?.toLowerCase() ?? 'unknown'}</span>.
        </p>
      </Card>
    );
  }

  const status = !cfg
    ? { label: 'Loading…', tone: 'text-slate-400' }
    : !cfg.configured
      ? { label: 'Not connected', tone: 'text-slate-500' }
      : cfg.last_test_ok === true
        ? { label: 'Connected', tone: 'text-emerald-600' }
        : cfg.last_test_ok === false
          ? { label: 'Connection failed', tone: 'text-red-600' }
          : { label: 'Configured — not yet tested', tone: 'text-amber-600' };

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">PayChain (wallet-as-a-service)</h3>
        <span className={`text-sm font-medium ${status.tone}`}>{status.label}</span>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Connect your own PayChain account so loyalty points are issued as digital value.{' '}
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-brand-600 underline">
          Get credentials
        </a>
        . Your client secret is encrypted and never shown again after saving.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">
          <div className="mb-1 text-slate-600">Client ID</div>
          <input
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            placeholder="from your PayChain operator"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-600">
            Client secret{' '}
            {cfg?.configured && (
              <span className="text-slate-400">
                — stored: {cfg.client_secret_preview ?? 'unreadable (encryption key changed)'}
              </span>
            )}
          </div>
          <input
            type="password"
            autoComplete="new-password"
            value={form.client_secret}
            onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
            placeholder={cfg?.configured ? 'leave blank to keep current' : 'required'}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-600">Loyalty asset ID <span className="font-normal text-slate-400">(optional)</span></div>
          <input
            value={form.loyalty_asset_id}
            onChange={(e) => setForm({ ...form, loyalty_asset_id: e.target.value })}
            placeholder="leave blank — create one in the PayChain Console"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-600">API base URL</div>
          <input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://api.paychain.cambobia.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={!!busy || !form.client_id || (!cfg?.configured && !form.client_secret)}>
          {busy === 'save' ? 'Saving…' : cfg?.configured ? 'Update' : 'Connect'}
        </Button>
        <Button variant="secondary" onClick={runTest} disabled={!!busy || !cfg?.configured}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        {cfg?.configured && (
          <Button variant="danger" onClick={disconnect} disabled={!!busy}>
            Disconnect
          </Button>
        )}
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>

      {/* Live result takes precedence over the stored one, so a fresh test is
          never masked by an older outcome. */}
      {(test || cfg?.last_test_detail) && (
        <p className={`mt-2 text-sm ${(test ? test.ok : cfg?.last_test_ok) ? 'text-emerald-600' : 'text-red-600'}`}>
          {test ? `${test.detail} (${test.latency_ms}ms)` : cfg?.last_test_detail}
          {!test && cfg?.last_tested_at && (
            <span className="text-slate-400"> — last checked {new Date(cfg.last_tested_at).toLocaleString()}</span>
          )}
        </p>
      )}

      {cfg?.configured && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {!cfg.readiness.ready && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <div className="font-medium">Not ready to go live yet</div>
              <ul className="mt-1 space-y-1">
                {(Object.values(cfg.readiness.checks)).filter((c) => !c.ok).map((c) => (
                  <li key={c.detail}>• {c.detail}</li>
                ))}
              </ul>
            </div>
          )}
          <Toggle
            label="Issue points to PayChain"
            hint="When off, points stay in PayKH's own ledger only."
            checked={cfg.enabled}
            disabled={!!busy || (!cfg.enabled && !cfg.readiness.ready)}
            onChange={(v) => setFlag('paychain.enabled', v)}
          />
          <Toggle
            label="Shadow mode"
            hint="Dual-write to PayChain and compare, with PayKH's ledger remaining the source of truth. Recommended before going live."
            checked={cfg.shadow_mode}
            disabled={!!busy}
            onChange={(v) => setFlag('paychain.shadow_mode.enabled', v)}
          />
        </div>
      )}
    </Card>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span>
        <span className="font-medium text-slate-700">{label}</span>
        <span className="block text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
