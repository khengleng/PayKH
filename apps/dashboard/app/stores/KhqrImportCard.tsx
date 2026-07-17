'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';

interface Account {
  currency: 'USD' | 'KHR';
  bakong_account_id: string;
  account_information?: string | null;
  merchant_name?: string | null;
  merchant_city?: string | null;
  acquiring_bank?: string | null;
  account_type?: 'individual' | 'merchant';
}
interface Imported {
  imported: boolean;
  accounts?: Account[];
  sample_qr?: string;
  unreadable?: boolean;
  detail?: string;
  updated_at?: string;
}

/**
 * Import the KHQR a merchant's own bank issued, so PayKH can reissue it with an
 * amount per payment.
 *
 * The QR is decoded in the BROWSER: the image never leaves the device, and the
 * server only ever receives the payload string it would have to validate
 * anyway. That keeps image handling — and its parser attack surface — out of
 * the API entirely.
 */
export function KhqrImportCard({ storeId }: { storeId: string }) {
  const [cur, setCur] = useState<Imported | null>(null);
  const [qrString, setQrString] = useState('');
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setCur(await api<Imported>(`/dashboard/stores/${storeId}/khqr`)); } catch { /* not fatal */ }
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  /** Decode a QR image locally. */
  const onFile = async (file: File) => {
    setErr(''); setMsg(''); setSample(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable in this browser');
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(data, width, height);
      if (!found?.data) {
        throw new Error('No QR code found in that image. Try a sharper screenshot, or paste the code text instead.');
      }
      setQrString(found.data);
      setMsg('QR read from image — check it below, then import.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that image');
    }
  };

  const doImport = async () => {
    setBusy(true); setErr(''); setMsg(''); setSample(null);
    try {
      const r = await api<Imported>(`/dashboard/stores/${storeId}/khqr/import`, {
        method: 'POST',
        body: { qr_string: qrString.trim() },
      });
      setSample(r.sample_qr ?? null);
      setQrString('');
      if (fileRef.current) fileRef.current.value = '';
      setMsg('Imported.');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const removeCurrency = async (currency: 'USD' | 'KHR') => {
    if (!confirm(`Remove the ${currency} account? PayKH will stop issuing ${currency} QR codes that pay it.`)) return;
    setBusy(true); setSample(null);
    try { await api(`/dashboard/stores/${storeId}/khqr?currency=${currency}`, { method: 'DELETE' }); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Bank account for payments (KHQR)</h3>
        <span className={`text-sm font-medium ${cur?.imported ? 'text-emerald-600' : 'text-slate-500'}`}>
          {cur?.imported ? (cur.unreadable ? 'Needs re-import' : 'Connected') : 'Not connected'}
        </span>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Upload the KHQR your own bank gave you (Wing, ABA, ACLEDA — any of them). PayKH reads the Bakong account from
        it and issues QR codes that pay <em>you</em> directly. No bank sign-up needed.
      </p>

      {cur?.imported && !cur.unreadable && cur.accounts && (
        <div className="mb-3 space-y-2">
          {cur.accounts.map((a) => (
            <div key={a.currency} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">{a.currency}</span>
                <span className="font-medium text-slate-700">{a.merchant_name ?? 'Account'}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-slate-600">{a.bakong_account_id}</div>
              <div className="mt-1 text-xs text-slate-500">
                {a.account_type} · {a.merchant_city}
                {a.account_information ? ` · acct ${a.account_information}` : ''}
                {a.acquiring_bank ? ` · ${a.acquiring_bank}` : ''}
              </div>
              <button onClick={() => removeCurrency(a.currency)} disabled={busy} className="mt-1 text-xs text-red-600 hover:underline">Remove {a.currency}</button>
            </div>
          ))}
          <p className="text-xs text-slate-400">
            Upload a second QR to add the other currency — Wing gives you a separate KHR and USD account.
          </p>
        </div>
      )}
      {cur?.unreadable && <p className="mb-3 text-sm text-amber-600">{cur.detail}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <div className="mb-1 text-slate-600">Upload your KHQR image</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <div className="mb-1 text-slate-600">…or paste the KHQR code text</div>
        <textarea
          value={qrString}
          onChange={(e) => setQrString(e.target.value)}
          placeholder="00020101021129..."
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={doImport} disabled={busy || qrString.trim().length < 12}>
          {busy ? 'Checking…' : cur?.imported ? 'Add / replace a currency' : 'Import account'}
        </Button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>

      {/* Scan this to prove the account is really theirs before any customer
          ever sees a PayKH QR. */}
      {sample && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-sm font-medium text-emerald-800">Test it: scan this QR with your banking app</div>
          <div className="mb-2 text-xs text-emerald-700">
            It should show your own name, and let you enter any amount — just like the QR your bank issued. This is a
            real KHQR built from the account you just imported, so paying it sends money to you.
          </div>
          <div className="inline-block rounded-lg bg-white p-3">
            <QRCodeSVG value={sample} size={180} level="M" includeMargin />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-emerald-700">Show code text</summary>
            <code className="mt-1 block break-all text-[10px] text-emerald-900/70">{sample}</code>
          </details>
        </div>
      )}
    </Card>
  );
}
