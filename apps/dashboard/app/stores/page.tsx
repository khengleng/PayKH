'use client';

import { useState } from 'react';
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

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-slate-600">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
    </label>
  );
}
