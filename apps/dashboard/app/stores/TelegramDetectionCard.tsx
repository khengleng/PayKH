'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';

interface Status {
  bot_configured: boolean;
  verified: boolean;
  chat_id: string | null;
  verify_code: string | null;
}

/**
 * Connect the Telegram chat where the merchant's bank posts payment alerts, so
 * PayKH can offer one-tap confirmation of counter payments. Binding is proved by
 * posting a one-time code into the chat — PayKH only ever trusts that one chat.
 */
export function TelegramDetectionCard({ storeId }: { storeId: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSt(await api<Status>(`/dashboard/stores/${storeId}/telegram-detection`).catch(() => null));
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const begin = async () => { setBusy(true); try { await api(`/dashboard/stores/${storeId}/telegram-detection/verify`, { method: 'POST' }); await load(); } finally { setBusy(false); } };
  const unlink = async () => { if (!confirm('Disconnect the payment-alert chat?')) return; setBusy(true); try { await api(`/dashboard/stores/${storeId}/telegram-detection/unlink`, { method: 'POST' }); await load(); } finally { setBusy(false); } };

  if (!st) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Auto-detect payments (Telegram)</h3>
        <span className={`text-sm font-medium ${st.verified ? 'text-emerald-600' : 'text-slate-500'}`}>{st.verified ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Connect the Telegram chat where your bank posts payment alerts. When a customer pays, PayKH matches the alert
        to the charge and offers a one-tap confirm at the counter. PayKH never marks a payment paid by itself.
      </p>

      {!st.bot_configured && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
          A platform admin must set the Telegram bot token first (Admin → Settings).
        </p>
      )}

      {st.verified ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">Reading alerts from chat <span className="font-mono text-xs">{st.chat_id}</span></span>
          <Button variant="danger" size="sm" onClick={unlink} disabled={busy}>Disconnect</Button>
        </div>
      ) : st.verify_code ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <ol className="ml-4 list-decimal space-y-1 text-slate-600">
            <li>Add the PayKH bot to the Telegram group that receives your bank alerts.</li>
            <li>Post this code in that group:</li>
          </ol>
          <div className="my-2 select-all rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-semibold tracking-wider text-brand-700">{st.verify_code}</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={load} disabled={busy}>I posted it — check</Button>
            <span className="text-xs text-slate-400">The bot binds the chat once it sees the code.</span>
          </div>
        </div>
      ) : (
        <Button onClick={begin} disabled={busy || !st.bot_configured}>{busy ? 'Starting…' : 'Connect a chat'}</Button>
      )}
    </Card>
  );
}
