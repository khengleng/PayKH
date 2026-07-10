'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { API_BASE, CheckoutView, PaymentStatus, TERMINAL } from './types';
import {
  CancelledScreen,
  ExpiredScreen,
  FailureScreen,
  SuccessScreen,
} from './StatusScreens';

type ConnState = 'live' | 'polling' | 'connecting';

function useCountdown(expiresAt?: string): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return remaining;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PayPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [view, setView] = useState<CheckoutView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchView = useCallback(async (): Promise<CheckoutView | null> => {
    try {
      const res = await fetch(`${API_BASE}/checkout/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        setError('Payment not found.');
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CheckoutView;
      setView(data);
      setError(null);
      return data;
    } catch {
      setError((prev) => prev ?? 'Unable to load payment. Retrying…');
      return null;
    }
  }, [id]);

  const startPolling = useCallback(() => {
    setConn('polling');
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const data = await fetchView();
      if (data && TERMINAL.includes(data.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }, [fetchView]);

  // Initial load + realtime subscription (SSE with polling fallback).
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    (async () => {
      const data = await fetchView();
      if (cancelled || !data) return;
      if (TERMINAL.includes(data.status)) return;

      try {
        es = new EventSource(`${API_BASE}/checkout/${id}/events`);
        es.addEventListener('status', (evt) => {
          const payload = JSON.parse((evt as MessageEvent).data) as { status: PaymentStatus };
          setConn('live');
          setView((prev) => (prev ? { ...prev, status: payload.status } : prev));
          if (TERMINAL.includes(payload.status)) fetchView();
        });
        es.addEventListener('done', () => es?.close());
        es.onopen = () => setConn('live');
        es.onerror = () => {
          es?.close();
          es = null;
          startPolling(); // fall back to polling
        };
      } catch {
        startPolling();
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, fetchView, startPolling]);

  const remaining = useCountdown(view?.expires_at);

  const copyReference = async () => {
    const ref = view?.reference_id ?? view?.id;
    if (!ref) return;
    await navigator.clipboard.writeText(ref);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error && !view) {
    return (
      <Shell>
        <p className="text-center text-slate-600">{error}</p>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <p className="animate-pulse text-center text-slate-500">Loading payment…</p>
      </Shell>
    );
  }

  const accent = view.merchant.primary_color;

  return (
    <Shell accent={accent}>
      {/* Merchant header */}
      <div className="flex flex-col items-center border-b border-slate-100 pb-5">
        {view.merchant.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.merchant.logo_url} alt={view.merchant.name} className="h-12 w-12 rounded-lg object-contain" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold text-white"
            style={{ background: accent }}
          >
            {view.merchant.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="mt-3 text-lg font-semibold">{view.merchant.name}</h1>
        <div className="mt-1 text-3xl font-bold tracking-tight">
          {view.amount} <span className="text-lg font-medium text-slate-500">{view.currency}</span>
        </div>
        {view.description && <p className="mt-1 text-sm text-slate-500">{view.description}</p>}
      </div>

      {view.status === 'paid' && <div className="pt-6"><SuccessScreen view={view} /></div>}
      {view.status === 'failed' && <div className="pt-6"><FailureScreen view={view} /></div>}
      {view.status === 'expired' && <div className="pt-6"><ExpiredScreen view={view} /></div>}
      {view.status === 'cancelled' && <div className="pt-6"><CancelledScreen /></div>}

      {(view.status === 'pending' || view.status === 'scanned') && (
        <div className="pt-6">
          <div className="flex flex-col items-center">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <QRCodeSVG value={view.qr_string} size={220} level="M" includeMargin />
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Scan with any Bakong-enabled banking app
            </p>

            {view.status === 'scanned' && (
              <div className="mt-3 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
                QR scanned — awaiting confirmation…
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className={remaining <= 30 ? 'text-red-600' : 'text-slate-600'}>
                Expires in <span className="font-mono font-semibold">{formatClock(remaining)}</span>
              </span>
            </div>
          </div>

          {/* Reference + actions */}
          <div className="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Reference</span>
              <button onClick={copyReference} className="font-mono font-medium text-slate-800 hover:underline">
                {view.reference_id ?? view.id} {copied ? '✓' : '⧉'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Status</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${conn === 'live' ? 'bg-emerald-500' : 'bg-amber-400'}`}
                />
                {conn === 'live' ? 'Live' : conn === 'polling' ? 'Checking…' : 'Connecting…'}
              </span>
            </div>
          </div>

          <button
            onClick={() => fetchView()}
            className="mt-4 w-full rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh status
          </button>
        </div>
      )}

      {view.merchant.support_email && (
        <p className="mt-6 text-center text-xs text-slate-400">
          Need help? Contact{' '}
          <a className="underline" href={`mailto:${view.merchant.support_email}`}>
            {view.merchant.support_email}
          </a>
        </p>
      )}
    </Shell>
  );
}

function Shell({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-100">
        {children}
        <div className="mt-6 flex items-center justify-center gap-1 text-[11px] text-slate-400">
          <span>Secured by</span>
          <span className="font-semibold" style={{ color: accent ?? '#4F46E5' }}>PayKH</span>
        </div>
      </div>
    </main>
  );
}
