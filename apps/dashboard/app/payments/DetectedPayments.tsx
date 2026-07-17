'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';

interface Detection {
  id: string;
  payment_id: string | null;
  amount: string | null;
  currency: string | null;
  match_count: number;
  confirmed: boolean;
  at: string;
  text: string;
}

/**
 * Telegram-detected bank payments awaiting a merchant tap.
 *
 * The POS Charge screen already offers confirm for a charge it is actively
 * watching, but a payment-link payment (or a charge the cashier navigated away
 * from) is detected with nobody watching. This surfaces those so any matched,
 * still-pending detection can be confirmed — the assist-mode confirmation for
 * everything that is not a live POS charge.
 */
export function DetectedPayments({ storeId, onConfirmed }: { storeId: string; onConfirmed: () => void }) {
  const [rows, setRows] = useState<Detection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api<Detection[]>(`/dashboard/stores/${storeId}/telegram-detection/recent`).catch(() => []));
  }, [storeId]);

  useEffect(() => {
    load();
    // Detections arrive seconds after a customer pays; poll while the page is open.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const confirm = async (d: Detection) => {
    setBusy(d.id);
    try {
      await api(`/dashboard/stores/${storeId}/telegram-detection/confirm`, { method: 'POST', body: { detection_id: d.id } });
      await load();
      onConfirmed();
    } catch {
      /* surfaced by the row staying put */
    } finally {
      setBusy(null);
    }
  };

  // Only surface actionable ones: matched to a payment and not yet confirmed.
  const pending = (rows ?? []).filter((d) => d.payment_id && !d.confirmed);
  if (pending.length === 0) return null;

  return (
    <Card className="mb-4 border-emerald-200 bg-emerald-50/50">
      <h3 className="mb-2 font-semibold text-emerald-800">Detected payments — confirm to mark paid</h3>
      <p className="mb-3 text-sm text-emerald-700">
        Your bank alerts matched these pending charges. Confirm each once you have verified it arrived.
      </p>
      <div className="space-y-2">
        {pending.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm">
            <div>
              <span className="font-semibold">{d.amount} {d.currency}</span>
              <span className="ml-2 font-mono text-xs text-slate-500">{d.payment_id}</span>
              <span className="ml-2 text-xs text-slate-400">{new Date(d.at).toLocaleTimeString()}</span>
            </div>
            <Button size="sm" onClick={() => confirm(d)} disabled={busy === d.id}>
              {busy === d.id ? 'Confirming…' : 'Confirm paid'}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
