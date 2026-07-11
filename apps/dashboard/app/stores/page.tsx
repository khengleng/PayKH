'use client';

import { useEffect, useState } from 'react';
import { Shell, ShellContext } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api, API_BASE } from '@/lib/api';
import { Store } from '@/lib/types';

export default function StoresPage() {
  return <Shell>{(ctx) => <StoresContent ctx={ctx} />}</Shell>;
}

function StoresContent({ ctx }: { ctx: ShellContext }) {
  const { me, stores, activeStore, reloadStores } = ctx;
  const orgId = me.organizations[0]?.id;
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const createStore = async () => {
    if (!newName || !orgId) return;
    setBusy(true);
    try {
      await api('/stores', { method: 'POST', body: { organizationId: orgId, name: newName } });
      setNewName('');
      await reloadStores();
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
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Shop" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <Button onClick={createStore} disabled={busy || !newName}>Create store</Button>
        </div>
      </Card>

      {stores.length === 0 && <Card className="text-slate-500">No stores yet — create your first one above.</Card>}

      {activeStore && <StoreEditor store={activeStore} onChange={reloadStores} />}
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
      <LoyaltyCard storeId={store.id} />
      <TiersCard storeId={store.id} />
      <RewardsCard storeId={store.id} />
      <ReferralsCard storeId={store.id} />

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

function LoyaltyCard({ storeId }: { storeId: string }) {
  const [active, setActive] = useState(false);
  const [ppu, setPpu] = useState('1');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ active: boolean; points_per_unit: string }>(`/dashboard/stores/${storeId}/loyalty`).then((p) => { setActive(p.active); setPpu(p.points_per_unit); });
  }, [storeId]);

  const save = async () => {
    const p = await api<{ active: boolean; points_per_unit: string }>(`/dashboard/stores/${storeId}/loyalty`, { method: 'PUT', body: { active, pointsPerUnit: ppu } });
    setActive(p.active); setPpu(p.points_per_unit); setMsg('Saved'); setTimeout(() => setMsg(''), 1500);
  };

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
        <Button onClick={save}>Save</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
    </Card>
  );
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

interface Referral { id: string; referrer: string; referee: string; code: string; status: string; reward_referrer: number; reward_referee: number }

function ReferralsCard({ storeId }: { storeId: string }) {
  const [active, setActive] = useState(false);
  const [referrer, setReferrer] = useState('50');
  const [referee, setReferee] = useState('25');
  const [rows, setRows] = useState<Referral[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const p = await api<any>(`/dashboard/stores/${storeId}/referral-program`);
    setActive(p.active); setReferrer(String(p.referrer_points)); setReferee(String(p.referee_points));
    setRows(await api<Referral[]>(`/dashboard/stores/${storeId}/referrals`));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  const save = async () => {
    await api(`/dashboard/stores/${storeId}/referral-program`, { method: 'PUT', body: { active, referrerPoints: Number(referrer), refereePoints: Number(referee) } });
    setMsg('Saved'); setTimeout(() => setMsg(''), 1500); await load();
  };

  return (
    <Card>
      <h3 className="mb-1 font-semibold">Referrals</h3>
      <p className="mb-3 text-sm text-slate-500">Customers get a referral code (<code>POST /v1/customers/:id/referral-code</code>); both are rewarded on the referee's first paid payment.</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Referrer points</div><input value={referrer} onChange={(e) => setReferrer(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><div className="mb-1 text-slate-600">Referee points</div><input value={referee} onChange={(e) => setReferee(e.target.value)} className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <Button onClick={save}>Save</Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
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

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-slate-600">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
    </label>
  );
}
