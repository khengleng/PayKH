'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import jsQR from 'jsqr';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';

interface Imported {
  imported: boolean;
  bakong_account_id?: string;
  merchant_name?: string | null;
  merchant_city?: string | null;
  acquiring_bank?: string | null;
  account_type?: 'individual' | 'merchant';
  source_was_static?: boolean;
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

  const remove = async () => {
    if (!confirm('Remove this account? PayKH will stop issuing QR codes that pay it.')) return;
    setBusy(true); setSample(null);
    try { await api(`/dashboard/stores/${storeId}/khqr`, { method: 'DELETE' }); await load(); }
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

      {cur?.imported && !cur.unreadable && (
        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="font-medium text-slate-700">{cur.merchant_name ?? 'Account'}</div>
          <div className="font-mono text-xs text-slate-600">{cur.bakong_account_id}</div>
          <div className="mt-1 text-xs text-slate-500">
            {cur.account_type} · {cur.merchant_city}
            {cur.acquiring_bank ? ` · ${cur.acquiring_bank}` : ''}
          </div>
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
          {busy ? 'Checking…' : cur?.imported ? 'Replace account' : 'Import account'}
        </Button>
        {cur?.imported && <Button variant="danger" onClick={remove} disabled={busy}>Remove</Button>}
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>

      {/* Scan this to prove the account is really theirs before any customer
          ever sees a PayKH QR. */}
      {sample && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-sm font-medium text-emerald-800">Test it: scan this $1.00 QR with your banking app</div>
          <div className="mb-2 text-xs text-emerald-700">
            It should show your own name. This is a real KHQR built from the account you just imported — paying it
            sends $1.00 to you.
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
