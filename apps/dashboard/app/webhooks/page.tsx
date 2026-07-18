'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { WebhookDelivery, WebhookEndpoint, WEBHOOK_EVENT_TYPES } from '@/lib/types';

export default function WebhooksPage() {
  return (
    <Shell>
      {({ activeStore }) =>
        activeStore ? (
          <WebhooksContent storeId={activeStore.id} />
        ) : (
          <Card className="text-slate-600">Create a store first.</Card>
        )
      }
    </Shell>
  );
}

function WebhooksContent({ storeId }: { storeId: string }) {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [deadCount, setDeadCount] = useState(0);
  const [replaying, setReplaying] = useState(false);

  const load = useCallback(async () => {
    const [eps, dead] = await Promise.all([
      api<WebhookEndpoint[]>(`/webhook-endpoints?store_id=${storeId}`),
      api<{ count: number }>(`/webhook-endpoints/dead-lettered/count?store_id=${storeId}`),
    ]);
    setEndpoints(eps);
    setDeadCount(dead.count);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const flashMsg = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 2500);
  };

  const create = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const ep = await api<WebhookEndpoint>('/webhook-endpoints', {
        method: 'POST',
        body: { storeId, url, enabledEvents: events },
      });
      if (ep.signing_secret) setRevealed({ id: ep.id, secret: ep.signing_secret });
      setUrl('');
      setEvents([]);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (ep: WebhookEndpoint) => {
    await api(`/webhook-endpoints/${ep.id}`, { method: 'PATCH', body: { disabled: !ep.disabled } });
    await load();
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this webhook endpoint?')) return;
    await api(`/webhook-endpoints/${id}`, { method: 'DELETE' });
    await load();
  };
  const reveal = async (id: string) => {
    const r = await api<{ signing_secret: string }>(`/webhook-endpoints/${id}/secret`);
    setRevealed({ id, secret: r.signing_secret });
  };
  const rotate = async (id: string) => {
    if (!confirm('Rotate signing secret? The old one stays valid for 24h.')) return;
    const r = await api<{ signing_secret: string }>(`/webhook-endpoints/${id}/rotate-secret`, { method: 'POST' });
    setRevealed({ id, secret: r.signing_secret });
    flashMsg('Secret rotated');
  };
  const sendTest = async (id: string) => {
    await api(`/webhook-endpoints/${id}/test`, { method: 'POST' });
    flashMsg('Test event queued');
  };
  const replayDeadLettered = async () => {
    setReplaying(true);
    try {
      const r = await api<{ replayed: number; remaining: number }>(
        `/webhook-endpoints/replay-dead-lettered?store_id=${storeId}`,
        { method: 'POST' },
      );
      flashMsg(
        r.remaining > 0
          ? `Re-queued ${r.replayed} — ${r.remaining} still pending, click again to continue`
          : `Re-queued ${r.replayed} dead-lettered ${r.replayed === 1 ? 'delivery' : 'deliveries'}`,
      );
      await load();
    } finally {
      setReplaying(false);
    }
  };

  return (
    <>
      <PageTitle title="Webhooks" subtitle="Receive signed events. Verify with X-Payment-Signature (HMAC-SHA256)." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 text-sm">
            <div className="mb-1 text-slate-600">Endpoint URL</div>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/paykh" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <Button onClick={create} disabled={busy || !url}>Add endpoint</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEBHOOK_EVENT_TYPES.map((ev) => {
            const on = events.includes(ev);
            return (
              <button
                key={ev}
                onClick={() => setEvents((prev) => (on ? prev.filter((e) => e !== ev) : [...prev, ev]))}
                className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500'}`}
              >
                {ev}
              </button>
            );
          })}
          <span className="self-center text-xs text-slate-400">
            {events.length === 0 ? '(none selected = all events)' : `${events.length} selected`}
          </span>
        </div>
      </Card>

      {deadCount > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50">
          <div className="text-sm text-amber-900">
            <span className="font-medium">{deadCount}</span> dead-lettered{' '}
            {deadCount === 1 ? 'delivery' : 'deliveries'} exhausted every retry. Once the receiver is
            live, replay to flush the backlog.
          </div>
          <Button onClick={replayDeadLettered} disabled={replaying}>
            {replaying ? 'Replaying…' : 'Replay all dead-lettered'}
          </Button>
        </Card>
      )}

      {revealed && (
        <Card className="mb-4 border border-emerald-200 bg-emerald-50">
          <div className="text-sm font-medium text-emerald-800">Signing secret (store it securely):</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm">{revealed.secret}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(revealed.secret)}>Copy</Button>
            <Button variant="secondary" onClick={() => setRevealed(null)}>Done</Button>
          </div>
        </Card>
      )}
      {flash && <div className="mb-4 text-sm text-emerald-600">{flash}</div>}

      <div className="space-y-3">
        {endpoints.length === 0 && <Card className="text-slate-400">No webhook endpoints yet.</Card>}
        {endpoints.map((ep) => (
          <Card key={ep.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{ep.url}</span>
                  {ep.disabled ? <StatusBadge status="failed" /> : <StatusBadge status="paid" />}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {ep.enabled_events.length === 0 ? 'all events' : ep.enabled_events.join(', ')}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button onClick={() => sendTest(ep.id)} className="text-brand-600 hover:underline">Send test</button>
                <button onClick={() => setOpenDeliveries(openDeliveries === ep.id ? null : ep.id)} className="text-slate-600 hover:underline">Deliveries</button>
                <button onClick={() => reveal(ep.id)} className="text-slate-600 hover:underline">Secret</button>
                <button onClick={() => rotate(ep.id)} className="text-slate-600 hover:underline">Rotate</button>
                <button onClick={() => toggle(ep)} className="text-slate-600 hover:underline">{ep.disabled ? 'Enable' : 'Disable'}</button>
                <button onClick={() => remove(ep.id)} className="text-red-600 hover:underline">Delete</button>
              </div>
            </div>
            {openDeliveries === ep.id && <Deliveries endpointId={ep.id} onResent={() => flashMsg('Delivery re-queued')} />}
          </Card>
        ))}
      </div>
    </>
  );
}

function Deliveries({ endpointId, onResent }: { endpointId: string; onResent: () => void }) {
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(await api<WebhookDelivery[]>(`/webhook-endpoints/${endpointId}/deliveries`));
  }, [endpointId]);
  useEffect(() => {
    load();
  }, [load]);
  const resend = async (id: string) => {
    await api(`/webhook-endpoints/deliveries/${id}/resend`, { method: 'POST' });
    onResent();
    setTimeout(load, 500);
  };

  return (
    <div className="mt-3 overflow-x-auto border-t border-slate-100 pt-3">
      {!rows ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No deliveries yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1">Event</th><th>Status</th><th>Attempt</th><th>HTTP</th><th>When</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const isOpen = expanded === d.id;
              return (
                <Fragment key={d.id}>
                  <tr className="border-t border-slate-50">
                    <td className="py-1">
                      <button
                        onClick={() => setExpanded(isOpen ? null : d.id)}
                        className="flex items-center gap-1 text-left hover:text-brand-600"
                        title="Show delivery detail"
                      >
                        <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                        {d.event_type ?? '—'}
                      </button>
                    </td>
                    <td><StatusBadge status={d.status === 'succeeded' ? 'paid' : d.status === 'failed' ? 'failed' : 'pending'} /></td>
                    <td>{d.attempt}</td>
                    <td>{d.response_status ?? (d.error ? 'err' : '—')}</td>
                    <td className="text-slate-400">{new Date(d.created_at).toLocaleTimeString()}</td>
                    <td className="text-right"><button onClick={() => resend(d.id)} className="text-brand-600 hover:underline">Resend</button></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-3 py-2">
                        <DeliveryDetail d={d} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DeliveryDetail({ d }: { d: WebhookDelivery }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
      <dt className="text-slate-400">Event ID</dt>
      <dd className="font-mono break-all">{d.event_id}</dd>
      <dt className="text-slate-400">Delivery ID</dt>
      <dd className="font-mono break-all">{d.id}</dd>
      {d.next_attempt_at && (
        <>
          <dt className="text-slate-400">Next retry</dt>
          <dd>{new Date(d.next_attempt_at).toLocaleString()}</dd>
        </>
      )}
      {d.error && (
        <>
          <dt className="text-slate-400">Error</dt>
          <dd className="text-red-600">{d.error}</dd>
        </>
      )}
      <dt className="text-slate-400">Last response</dt>
      <dd>
        {d.response_body ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] text-slate-700">
            {d.response_body}
          </pre>
        ) : (
          <span className="text-slate-400">
            {d.response_status != null ? '(empty response body)' : 'no response received'}
          </span>
        )}
      </dd>
    </dl>
  );
}
