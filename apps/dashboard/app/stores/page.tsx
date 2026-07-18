'use client';

import { useEffect, useState } from 'react';
import { Shell, ShellContext } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api, API_BASE } from '@/lib/api';
import { Store } from '@/lib/types';
import { KhqrImportCard } from './KhqrImportCard';
import { TelegramDetectionCard } from './TelegramDetectionCard';

export default function StoresPage() {
  return <Shell>{(ctx) => <StoresContent ctx={ctx} />}</Shell>;
}

function StoresContent({ ctx }: { ctx: ShellContext }) {
  const { me, stores, activeStore, reloadStores, selectStore } = ctx;
  const orgId = me.organizations[0]?.id;
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const createStore = async () => {
    if (!newName || !orgId) return;
    setBusy(true); setErr('');
    try {
      const created = await api<Store>('/stores', { method: 'POST', body: { organizationId: orgId, name: newName } });
      setNewName('');
      await reloadStores();
      // Make the new store the active one so it shows immediately — no approval,
      // no waiting: a created store is live in the dashboard at once.
      if (created?.id) selectStore(created.id);
    } catch (e) {
      setErr((e as Error).message || 'Could not create the store.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Stores" subtitle="Manage stores, branding, credentials, and go-live." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <div className="mb-1 text-slate-600">New store name</div>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createStore()} placeholder="My Shop" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <Button onClick={createStore} disabled={busy || !newName}>{busy ? 'Creating…' : 'Create store'}</Button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {!orgId && <p className="mt-2 text-sm text-amber-600">No organization found on your account — sign out and back in, or contact support.</p>}
      </Card>

      {stores.length === 0 ? (
        <Card className="text-slate-500">No stores yet — create your first one above.</Card>
      ) : (
        <Card className="mb-4 p-0">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Your stores ({stores.length})</div>
          <ul className="divide-y divide-slate-50">
            {stores.map((s) => {
              const isActive = s.id === activeStore?.id;
              return (
                <li key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${isActive ? 'bg-brand-50/40' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800">{s.branding?.display_name || s.name}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.live_mode ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{s.live_mode ? 'Live' : 'Test'}</span>
                      {isActive && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">Selected</span>}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">{s.id}</div>
                  </div>
                  {isActive ? (
                    <span className="text-xs text-slate-400">Editing below</span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => selectStore(s.id)}>Manage</Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {activeStore && <StoreEditor key={activeStore.id} store={activeStore} onChange={reloadStores} />}
    </>
  );
}

function StoreEditor({ store, onChange }: { store: Store; onChange: () => Promise<void> }) {
  const b = store.branding;
  const [displayName, setDisplayName] = useState(b?.display_name ?? store.name);
  const [primaryColor, setPrimaryColor] = useState(b?.primary_color ?? '#4F46E5');
  const [logoUrl, setLogoUrl] = useState(b?.logo_url ?? '');
  const [supportEmail, setSupportEmail] = useState(b?.support_email ?? '');
  const [successUrl, setSuccessUrl] = useState(b?.success_url ?? '');
  const [failureUrl, setFailureUrl] = useState(b?.failure_url ?? '');
  const [customMessage, setCustomMessage] = useState(b?.custom_message ?? '');
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState('');

  const saveBranding = async () => {
    await api(`/stores/${store.id}/branding`, {
      method: 'PUT',
      body: {
        displayName,
        primaryColor,
        logoUrl: logoUrl || undefined,
        supportEmail: supportEmail || undefined,
        successUrl: successUrl || undefined,
        failureUrl: failureUrl || undefined,
        customMessage: customMessage || undefined,
      },
    });
    setSaved('Branding saved');
    setTimeout(() => setSaved(''), 2000);
    await onChange();
  };

  const saveCredential = async () => {
    if (!secret) return;
    await api(`/stores/${store.id}/credentials`, {
      method: 'PUT',
      body: { mode: store.live_mode ? 'live' : 'test', secret },
    });
    setSecret('');
    setSaved('Provider credential saved (encrypted)');
    setTimeout(() => setSaved(''), 2500);
  };

  const toggleLive = async () => {
    await api(`/stores/${store.id}/live-mode`, { method: 'PUT', body: { liveMode: !store.live_mode } });
    await onChange();
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{store.name}</h3>
            <p className="text-sm text-slate-500">
              {store.live_mode ? 'Live mode active' : 'Test mode — using mock provider'}
            </p>
          </div>
          <Button variant={store.live_mode ? 'danger' : 'primary'} onClick={toggleLive}>
            {store.live_mode ? 'Switch to test' : 'Activate live mode'}
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Checkout branding</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Display name" value={displayName} onChange={setDisplayName} />
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Primary color</div>
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-12 rounded border" />
              <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm" />
            </div>
          </label>
          <TextField label="Logo URL" value={logoUrl} onChange={setLogoUrl} placeholder="https://…" />
          <TextField label="Support email" value={supportEmail} onChange={setSupportEmail} />
          <TextField label="Success redirect URL" value={successUrl} onChange={setSuccessUrl} placeholder="https://…" />
          <TextField label="Failure redirect URL" value={failureUrl} onChange={setFailureUrl} placeholder="https://…" />
        </div>
        <label className="mt-3 block text-sm">
          <div className="mb-1 text-slate-600">Custom message</div>
          <textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveBranding}>Save branding</Button>
          {saved && <span className="text-sm text-emerald-600">{saved}</span>}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 font-semibold">Bakong provider credentials</h3>
        <p className="mb-3 text-sm text-slate-500">
          Stored encrypted (AES-256-GCM). Used by the real Bakong provider in Phase 2. In Phase 1 the mock provider is used regardless.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <div className="mb-1 text-slate-600">{store.live_mode ? 'Live' : 'Test'} secret / token</div>
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Bakong API token" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm" />
          </label>
          <Button variant="secondary" onClick={saveCredential} disabled={!secret}>Save credential</Button>
        </div>
      </Card>

      <BranchesCard storeId={store.id} />
      <KhqrImportCard storeId={store.id} />
      <TelegramDetectionCard storeId={store.id} />
      <LoyaltyCard storeId={store.id} />
      <TiersCard storeId={store.id} />
      <RewardsCard storeId={store.id} />
      <ReferralsCard storeId={store.id} />
      <TelegramCard storeId={store.id} />
      <ChannelsCard storeId={store.id} />

      <Card>
        <h3 className="mb-1 font-semibold">Run a test payment</h3>
        <p className="mb-3 text-sm text-slate-500">Create a test payment with your <code>bk_test_</code> key, then open its checkout URL.</p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{`curl -X POST ${API_BASE}/v1/payments \\
  -H "Authorization: Bearer bk_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"1.50","currency":"USD","reference_id":"order_1024"}'

# Then simulate completion (test keys only):
curl -X POST ${API_BASE}/v1/payments/PAY_ID/simulate \\
  -H "Authorization: Bearer bk_test_..." \\
  -d '{"status":"paid"}'`}</pre>
      </Card>
    </div>
  );
}

interface Branch { id: string; name: string; code: string | null; address: string | null; is_active: boolean }

function BranchesCard({ storeId }: { storeId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const load = async () => setBranches(await api<Branch[]>(`/stores/${storeId}/branches`));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const add = async () => {
    setErr('');
    try {
      await api(`/stores/${storeId}/branches`, { method: 'POST', body: { name, code: code || undefined } });
      setName(''); setCode(''); await load();
    } catch (e: any) { setErr(e.message); }
  };
  const toggle = async (b: Branch) => { await api(`/branches/${b.id}`, { method: 'PATCH', body: { isActive: !b.is_active } }); await load(); };
  const remove = async (b: Branch) => { if (!confirm('Delete/deactivate this branch?')) return; await api(`/branches/${b.id}`, { method: 'DELETE' }); await load(); };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Branches</h3>
      <p className="mb-3 text-sm text-slate-500">Sub-locations under this store. Attribute a payment with <code>branch_id</code>.</p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm"><div className="mb-1 text-slate-600">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Downtown" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Code (optional)</div>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="DT-01" className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={add} disabled={!name}>Add branch</Button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
      {branches.length === 0 ? <p className="text-sm text-slate-400">No branches yet.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {branches.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2">
              <span>{b.name} {b.code && <span className="text-slate-400">· {b.code}</span>} {!b.is_active && <span className="ml-1 text-xs text-red-500">(inactive)</span>}
                <span className="ml-2 font-mono text-[10px] text-slate-400">{b.id}</span></span>
              <span className="flex gap-2">
                <button onClick={() => toggle(b)} className="text-slate-600 hover:underline">{b.is_active ? 'Deactivate' : 'Activate'}</button>
                <button onClick={() => remove(b)} className="text-red-600 hover:underline">Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface Program { active: boolean; points_per_unit: string; expiry_months: number | null }
interface ExpiryPreview {
  months: number;
  expires_immediately: { customers: number; points: number };
  expires_within_warn_window: { customers: number; points: number; warn_days: number };
  sample: { customer: string; points: number }[];
}

function LoyaltyCard({ storeId }: { storeId: string }) {
  const [active, setActive] = useState(false);
  const [ppu, setPpu] = useState('1');
  const [msg, setMsg] = useState('');
  const [pointValue, setPointValue] = useState('0.01');
  const [liab, setLiab] = useState<any>(null);
  // null = never expire. Kept separate from the input so clearing the box does
  // not read as "expire everything".
  const [expiryMonths, setExpiryMonths] = useState<number | null>(null);
  const [expiryOn, setExpiryOn] = useState(false);
  const [preview, setPreview] = useState<ExpiryPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const loadLiab = async (pv: string) => setLiab(await api<any>(`/dashboard/stores/${storeId}/loyalty/liability?point_value=${pv}`));
  useEffect(() => {
    api<Program>(`/dashboard/stores/${storeId}/loyalty`).then((p) => {
      setActive(p.active); setPpu(p.points_per_unit);
      setExpiryMonths(p.expiry_months); setExpiryOn(p.expiry_months !== null);
    });
    loadLiab('0.01');
  }, [storeId]);

  // Preview whenever the window changes: enabling expiry is retroactive, so the
  // operator should see the cost before saving, not after.
  useEffect(() => {
    if (!expiryOn || !expiryMonths || expiryMonths < 1) { setPreview(null); return; }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const p = await api<ExpiryPreview>(`/dashboard/stores/${storeId}/loyalty/expiry-preview?months=${expiryMonths}`);
        if (!cancelled) setPreview(p);
      } catch { if (!cancelled) setPreview(null); }
      finally { if (!cancelled) setPreviewing(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [storeId, expiryOn, expiryMonths]);

  const save = async () => {
    const p = await api<Program>(`/dashboard/stores/${storeId}/loyalty`, {
      method: 'PUT',
      body: { active, pointsPerUnit: ppu, expiryMonths: expiryOn ? expiryMonths : null },
    });
    setActive(p.active); setPpu(p.points_per_unit);
    setExpiryMonths(p.expiry_months); setExpiryOn(p.expiry_months !== null);
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
    loadLiab(pointValue);
  };

  const doomed = preview?.expires_immediately.points ?? 0;
  const saveDisabled = expiryOn && (!expiryMonths || expiryMonths < 1);

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Loyalty points</h3>
      <p className="mb-3 text-sm text-slate-500">Customers earn points on paid payments (needs a <code>customer_id</code> on the payment).</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <label className="text-sm">
          <div className="mb-1 text-slate-600">Points per currency unit</div>
          <input value={ppu} onChange={(e) => setPpu(e.target.value)} className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <Button onClick={save} disabled={saveDisabled}>Save</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={expiryOn}
            onChange={(e) => { setExpiryOn(e.target.checked); if (e.target.checked && !expiryMonths) setExpiryMonths(12); }}
          />
          <span className="font-medium text-slate-700">Expire unused points</span>
        </label>
        <p className="mt-1 text-sm text-slate-500">
          {expiryOn
            ? 'Points expire this many months after they are earned. Customers are emailed 14 days before.'
            : 'Off — points never expire, and your liability keeps growing.'}
        </p>

        {expiryOn && (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <div className="mb-1 text-slate-600">Expire after (months)</div>
              <input
                type="number"
                min={1}
                value={expiryMonths ?? ''}
                onChange={(e) => setExpiryMonths(e.target.value ? Number(e.target.value) : null)}
                className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            {previewing && <span className="pb-2 text-sm text-slate-400">checking…</span>}
          </div>
        )}

        {/* The load-bearing part: expiry is retroactive, so show what saving
            would actually destroy before the operator commits to it. */}
        {expiryOn && preview && (
          <div className={`mt-3 rounded-lg border p-3 text-sm ${doomed > 0 ? 'border-red-200 bg-red-50' : 'border-slate-100'}`}>
            {doomed > 0 ? (
              <>
                <div className="font-medium text-red-700">
                  Saving this expires {doomed.toLocaleString()} point(s) across{' '}
                  {preview.expires_immediately.customers} customer(s) on the next daily sweep.
                </div>
                <div className="mt-1 text-red-600">
                  They are already older than {preview.months} month(s), so they will not get the{' '}
                  {preview.expires_within_warn_window.warn_days}-day warning.
                </div>
                {preview.sample.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-red-700/80">
                    {preview.sample.map((s) => (
                      <li key={s.customer}>• {s.customer} — {s.points.toLocaleString()} pt(s)</li>
                    ))}
                    {preview.expires_immediately.customers > preview.sample.length && (
                      <li>• …and {preview.expires_immediately.customers - preview.sample.length} more</li>
                    )}
                  </ul>
                )}
              </>
            ) : (
              <div className="text-slate-600">Nothing expires today at {preview.months} month(s).</div>
            )}
            {preview.expires_within_warn_window.points > 0 && (
              <div className="mt-2 text-slate-600">
                {preview.expires_within_warn_window.points.toLocaleString()} point(s) across{' '}
                {preview.expires_within_warn_window.customers} customer(s) expire in the next{' '}
                {preview.expires_within_warn_window.warn_days} days — those customers will be emailed.
              </div>
            )}
          </div>
        )}
      </div>
      {liab && (
        <div className="mt-4 rounded-lg border border-slate-100 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-medium">Points liability</span>
            <span className="text-slate-500">@ $</span>
            <input value={pointValue} onChange={(e) => { setPointValue(e.target.value); loadLiab(e.target.value || '0'); }} className="w-16 rounded border border-slate-200 px-2 py-0.5 text-xs" />
            <span className="text-slate-500">/point</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Outstanding" value={liab.outstanding_points} />
            <Stat label="Est. liability" value={`$${liab.estimated_liability}`} />
            <Stat label="Holders" value={liab.customers_with_balance} />
            <Stat label="Redemption rate" value={`${Math.round(liab.redemption_rate * 100)}%`} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

interface Tier { id: string; name: string; threshold: number; earn_multiplier: string }

function TiersCard({ storeId }: { storeId: string }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('0');
  const [mult, setMult] = useState('1');

  const load = async () => setTiers(await api<Tier[]>(`/dashboard/stores/${storeId}/tiers`));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const add = async () => {
    await api(`/dashboard/stores/${storeId}/tiers`, { method: 'POST', body: { name, threshold: Number(threshold), earnMultiplier: mult } });
    setName(''); await load();
  };
  const del = async (id: string) => { if (!confirm('Delete tier?')) return; await api(`/dashboard/tiers/${id}`, { method: 'DELETE' }); await load(); };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Loyalty tiers</h3>
      <p className="mb-3 text-sm text-slate-500">Auto-assigned by lifetime points; higher tiers earn a multiplier.</p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm"><div className="mb-1 text-slate-600">Tier name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Lifetime pts</div><input value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Earn ×</div><input value={mult} onChange={(e) => setMult(e.target.value)} className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={add} disabled={!name}>Add tier</Button>
      </div>
      {tiers.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {tiers.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <span>{t.name} <span className="text-slate-400">· ≥{t.threshold} pts · ×{t.earn_multiplier}</span></span>
              <button onClick={() => del(t.id)} className="text-red-600 hover:underline">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface Reward { id: string; name: string; description: string | null; points_cost: number; stock: number; active: boolean }
interface Redemption { id: string; reward_name: string | null; points_spent: number; code: string; status: string; customer_name: string | null; created_at: string }

function RewardsCard({ storeId }: { storeId: string }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('100');
  const [stock, setStock] = useState('-1');

  const load = async () => {
    setRewards(await api<Reward[]>(`/dashboard/stores/${storeId}/rewards`));
    setRedemptions(await api<Redemption[]>(`/dashboard/stores/${storeId}/redemptions`));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const add = async () => {
    await api(`/dashboard/stores/${storeId}/rewards`, { method: 'POST', body: { name, pointsCost: Number(cost), stock: Number(stock) } });
    setName(''); await load();
  };
  const toggle = async (r: Reward) => { await api(`/dashboard/rewards/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); await load(); };
  const del = async (r: Reward) => { if (!confirm('Delete/deactivate reward?')) return; await api(`/dashboard/rewards/${r.id}`, { method: 'DELETE' }); await load(); };
  const fulfill = async (id: string) => { await api(`/dashboard/redemptions/${id}/fulfill`, { method: 'POST' }); await load(); };
  const cancel = async (id: string) => { await api(`/dashboard/redemptions/${id}/cancel`, { method: 'POST' }); await load(); };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Rewards catalog</h3>
      <p className="mb-3 text-sm text-slate-500">Customers redeem points for rewards (via <code>POST /v1/loyalty/redemptions</code>).</p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm"><div className="mb-1 text-slate-600">Reward name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="$5 off" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Points cost</div><input value={cost} onChange={(e) => setCost(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Stock (-1=∞)</div><input value={stock} onChange={(e) => setStock(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={add} disabled={!name}>Add reward</Button>
      </div>
      {rewards.length > 0 && (
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {rewards.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>{r.name} <span className="text-slate-400">· {r.points_cost} pts · stock {r.stock < 0 ? '∞' : r.stock}</span> {!r.active && <span className="text-xs text-red-500">(inactive)</span>}</span>
              <span className="flex gap-2"><button onClick={() => toggle(r)} className="text-slate-600 hover:underline">{r.active ? 'Deactivate' : 'Activate'}</button><button onClick={() => del(r)} className="text-red-600 hover:underline">Delete</button></span>
            </li>
          ))}
        </ul>
      )}
      {redemptions.length > 0 && (
        <>
          <div className="mb-1 text-sm font-medium text-slate-700">Recent redemptions</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {redemptions.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>{r.reward_name} <span className="font-mono text-xs text-slate-400">{r.code}</span> {r.customer_name && <span className="text-slate-400">· {r.customer_name}</span>}</span>
                <span className="flex items-center gap-2">
                  <span className={r.status === 'fulfilled' ? 'text-emerald-600' : r.status === 'cancelled' ? 'text-red-500' : 'text-amber-600'}>{r.status}</span>
                  {r.status === 'issued' && <><button onClick={() => fulfill(r.id)} className="text-emerald-600 hover:underline">Fulfill</button><button onClick={() => cancel(r.id)} className="text-red-600 hover:underline">Cancel</button></>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

interface Referral { id: string; referrer: string; referee: string; code: string; status: string; reward_referrer: number; reward_referee: number; flagged?: boolean; risk_flags?: string[] }
interface CommissionSummary { referrer: string; referrer_customer_id: string; currency: string; accrued: string; paid: string; count: number }
interface ReferralReport { funnel: { total: number; pending: number; qualified: number; rewarded: number; flagged: number }; conversion_rate: number; commission: Record<string, Record<string, string>> }

function ReferralsCard({ storeId }: { storeId: string }) {
  const [active, setActive] = useState(false);
  const [referrer, setReferrer] = useState('50');
  const [referee, setReferee] = useState('25');
  const [commissionPct, setCommissionPct] = useState('0');
  const [durationDays, setDurationDays] = useState('');
  const [rows, setRows] = useState<Referral[]>([]);
  const [flagged, setFlagged] = useState<Referral[]>([]);
  const [summary, setSummary] = useState<CommissionSummary[]>([]);
  const [report, setReport] = useState<ReferralReport | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const p = await api<any>(`/dashboard/stores/${storeId}/referral-program`);
    setActive(p.active); setReferrer(String(p.referrer_points)); setReferee(String(p.referee_points));
    setCommissionPct((p.commission_bps / 100).toString());
    setDurationDays(p.commission_duration_days ? String(p.commission_duration_days) : '');
    setRows(await api<Referral[]>(`/dashboard/stores/${storeId}/referrals`));
    setFlagged(await api<Referral[]>(`/dashboard/stores/${storeId}/referrals/flagged`));
    setSummary(await api<CommissionSummary[]>(`/dashboard/stores/${storeId}/commissions/summary`));
    setReport(await api<ReferralReport>(`/dashboard/stores/${storeId}/referrals/report`));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const review = async (referralId: string, action: 'clear' | 'void') => {
    await api(`/dashboard/stores/${storeId}/referrals/${referralId}/review`, { method: 'POST', body: { action } });
    setMsg(action === 'clear' ? 'Cleared — commissions released' : 'Voided'); setTimeout(() => setMsg(''), 2000); await load();
  };

  const save = async () => {
    await api(`/dashboard/stores/${storeId}/referral-program`, { method: 'PUT', body: {
      active, referrerPoints: Number(referrer), refereePoints: Number(referee),
      commissionBps: Math.round(Number(commissionPct) * 100),
      commissionDurationDays: durationDays ? Number(durationDays) : 0,
    } });
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500); await load();
  };

  const payout = async (referrerCustomerId?: string) => {
    const r = await api<{ paid_count: number; totals: { currency: string; amount: string }[] }>(`/dashboard/stores/${storeId}/commissions/payout`, { method: 'POST', body: referrerCustomerId ? { referrerCustomerId } : {} });
    setMsg(r.paid_count ? `Paid ${r.paid_count}: ${r.totals.map((t) => `${t.amount} ${t.currency}`).join(', ')}` : 'Nothing to pay');
    setTimeout(() => setMsg(''), 2500); await load();
  };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Referrals & Affiliate</h3>
      <p className="mb-3 text-sm text-slate-500">Customers get a referral code (<code>POST /v1/customers/:id/referral-code</code>); both earn points on the referee's first paid payment. Affiliate <b>commission</b> pays the referrer a % of every referee payment.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Referrer points</div><input value={referrer} onChange={(e) => setReferrer(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Referee points</div><input value={referee} onChange={(e) => setReferee(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Commission %</div><input value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Duration (days)</div><input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="lifetime" className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={save}>Save</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
      {report && report.funnel.total > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Referrals', report.funnel.total],
            ['Rewarded', report.funnel.rewarded],
            ['Pending', report.funnel.pending],
            ['Conversion', `${Math.round(report.conversion_rate * 100)}%`],
            ['Flagged', report.funnel.flagged],
          ].map(([label, val]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-lg font-semibold">{val}</div>
            </div>
          ))}
          {report.commission.paid && (
            <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 sm:col-span-5">
              <div className="text-xs text-slate-500">Commission</div>
              <div className="text-sm">
                {Object.entries(report.commission).map(([status, cur]) => (
                  <span key={status} className="mr-3"><span className="text-slate-500">{status}:</span> {Object.entries(cur).map(([c, a]) => `${a} ${c}`).join(', ')}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {flagged.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 text-sm font-medium text-amber-800">⚠ Fraud review — {flagged.length} flagged referral{flagged.length > 1 ? 's' : ''}</div>
          <ul className="divide-y divide-amber-100 text-sm">
            {flagged.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span>{r.referrer} → {r.referee} <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">{(r.risk_flags ?? []).join(', ')}</span></span>
                <span className="flex items-center gap-2">
                  <button onClick={() => review(r.id, 'clear')} className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">Clear</button>
                  <button onClick={() => review(r.id, 'void')} className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">Void</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.length > 0 && (
        <div className="mb-3 rounded-lg border border-slate-100 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Commission owed</span>
            <button onClick={() => payout()} className="rounded-md border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">Pay out all</button>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {summary.map((s) => (
              <li key={`${s.referrer_customer_id}-${s.currency}`} className="flex items-center justify-between py-2">
                <span>{s.referrer}</span>
                <span className="flex items-center gap-3">
                  <span className="text-amber-600">{s.accrued} {s.currency} owed</span>
                  <span className="text-xs text-slate-400">{s.paid} paid</span>
                  {Number(s.accrued) > 0 && <button onClick={() => payout(s.referrer_customer_id)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50">Pay</button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <span>{r.referrer} → {r.referee} <span className="font-mono text-xs text-slate-400">{r.code}</span></span>
              <span className={r.status === 'rewarded' ? 'text-emerald-600' : 'text-amber-600'}>{r.status}{r.status === 'rewarded' ? ` (+${r.reward_referrer}/+${r.reward_referee})` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const TG_EVENTS = ['payment.completed', 'payment.refunded', 'payment.failed', 'payment.expired', 'payment.cancelled'];

function TelegramCard({ storeId }: { storeId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [botConfigured, setBotConfigured] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const c = await api<any>(`/dashboard/stores/${storeId}/telegram`);
    setEnabled(c.enabled); setChatId(c.chat_id ?? ''); setEvents(c.enabled_events ?? []); setBotConfigured(c.bot_configured);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const save = async () => {
    await api(`/dashboard/stores/${storeId}/telegram`, { method: 'PUT', body: { enabled, chatId: chatId || undefined, enabledEvents: events } });
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500); await load();
  };
  const test = async () => {
    try { const r = await api<{ sent: boolean }>(`/dashboard/stores/${storeId}/telegram/test`, { method: 'POST' }); setMsg(r.sent ? 'Test sent' : 'Failed'); }
    catch (e: any) { setMsg(e.message); }
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Telegram notifications</h3>
      <p className="mb-3 text-sm text-slate-500">
        Get payment alerts in Telegram. {botConfigured ? '' : 'A platform bot token is not set yet — messages are logged until then.'}
        {' '}Add the bot to a chat, then paste the chat id.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Chat id</div><input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={save}>Save</Button>
        <Button variant="secondary" onClick={test}>Send test</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {TG_EVENTS.map((ev) => {
          const on = events.includes(ev);
          return <button key={ev} onClick={() => setEvents((p) => on ? p.filter((e) => e !== ev) : [...p, ev])} className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'}`}>{ev}</button>;
        })}
        <span className="self-center text-xs text-slate-400">{events.length === 0 ? '(none = all events)' : ''}</span>
      </div>
    </Card>
  );
}

interface Channel { channel: string; enabled: boolean; destination: string | null; enabled_events: string[]; provider_configured: boolean }

function ChannelsCard({ storeId }: { storeId: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => { setChannels(await api<Channel[]>(`/dashboard/stores/${storeId}/channels`)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const save = async (channel: string, patch: Partial<Channel>) => {
    const cur = channels.find((c) => c.channel === channel)!;
    await api(`/dashboard/stores/${storeId}/channels`, { method: 'PUT', body: {
      channel: channel.toUpperCase(),
      destination: (patch.destination ?? cur.destination) || undefined,
      enabled: patch.enabled ?? cur.enabled,
      enabledEvents: patch.enabled_events ?? cur.enabled_events,
    } });
    await load();
  };
  const test = async (channel: string) => {
    try { const r = await api<{ sent: boolean }>(`/dashboard/stores/${storeId}/channels/${channel}/test`, { method: 'POST' }); setMsg(r.sent ? `${channel} test sent` : 'Failed'); }
    catch (e: any) { setMsg(e.message); }
    setTimeout(() => setMsg(''), 2500);
  };

  const LABEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', signal: 'Signal' };
  return (
    <Card>
      <h3 className="mb-1 font-semibold">Messaging channels</h3>
      <p className="mb-3 text-sm text-slate-500">Mirror payment alerts to WhatsApp, SMS, or Signal. Messages are logged until provider credentials are configured. {msg && <span className="text-emerald-600">· {msg}</span>}</p>
      <div className="space-y-3">
        {channels.map((c) => (
          <div key={c.channel} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm w-24"><input type="checkbox" checked={c.enabled} onChange={(e) => save(c.channel, { enabled: e.target.checked })} /> {LABEL[c.channel]}</label>
            <label className="text-sm"><div className="mb-1 text-slate-600">Destination</div>
              <input defaultValue={c.destination ?? ''} placeholder={c.channel === 'signal' ? '+85512345678' : '+855…'} onBlur={(e) => save(c.channel, { destination: e.target.value })} className="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <Button variant="secondary" onClick={() => test(c.channel)}>Send test</Button>
            <span className="self-center text-xs text-slate-400">{c.provider_configured ? 'provider ready' : 'log-only'}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-slate-600">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
    </label>
  );
}
