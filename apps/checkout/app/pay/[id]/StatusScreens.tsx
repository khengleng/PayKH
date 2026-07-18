'use client';

import { CheckoutView } from './types';
import { money } from '@/lib/i18n';
import { BankMark } from '@/lib/bank';

function Icon({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <div
      className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl"
      style={{ background: bg }}
    >
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{children}</span>
    </div>
  );
}

export function SuccessScreen({ view }: { view: CheckoutView }) {
  const paidAt = view.paid_at ? new Date(view.paid_at) : null;
  return (
    <div className="text-center">
      <Icon bg="#dcfce7">✅</Icon>
      <h2 className="mt-4 text-xl font-semibold text-emerald-700">Payment successful</h2>
      <p className="mt-1 text-slate-600">{money(view.amount, view.currency)} received.</p>
      {view.merchant.custom_message && (
        <p className="mt-2 text-sm text-slate-500">{view.merchant.custom_message}</p>
      )}

      {/* Receipt — proof of who was paid, how much, and when. */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-left">
        <div className="mb-1 text-center text-[11px] uppercase tracking-wide text-slate-400">Receipt</div>
        <div className="mb-2 flex items-center justify-center text-2xl font-bold tracking-tight text-slate-800">
          {money(view.amount, view.currency)}
        </div>
        <div className="divide-y divide-slate-100">
          <Row label="Paid to">
            {view.payee ? (
              <span className="flex items-center justify-end gap-2">
                <BankMark code={view.payee.bank_code} name={view.payee.bank_name} size={22} />
                <span className="min-w-0">
                  <span className="block truncate">{view.payee.name ?? view.merchant.name}</span>
                  <span className="block text-xs font-normal text-slate-500">{view.payee.bank_name ?? ''}</span>
                </span>
              </span>
            ) : (
              view.merchant.name
            )}
          </Row>
          {view.payee && <Row label="Account"><span className="font-mono text-xs">{view.payee.account_id}</span></Row>}
          <Row label="Reference"><span className="font-mono text-xs">{view.reference_id ?? view.id}</span></Row>
          {paidAt && <Row label="Date">{paidAt.toLocaleString()}</Row>}
          <Row label="Status"><span className="text-emerald-600">Paid</span></Row>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Save receipt
        </button>
        {view.merchant.success_url && (
          <a
            className="rounded-lg px-5 py-2 text-sm font-medium text-white"
            style={{ background: view.merchant.primary_color }}
            href={view.merchant.success_url}
          >
            Continue
          </a>
        )}
      </div>
    </div>
  );
}

export function FailureScreen({ view }: { view: CheckoutView }) {
  return (
    <div className="text-center">
      <Icon bg="#fee2e2">❌</Icon>
      <h2 className="mt-4 text-xl font-semibold text-red-700">Payment failed</h2>
      <p className="mt-1 text-slate-600">This payment could not be completed.</p>
      {view.merchant.failure_url && (
        <a
          className="mt-6 inline-block rounded-lg border px-5 py-2.5 font-medium"
          href={view.merchant.failure_url}
        >
          Go back
        </a>
      )}
    </div>
  );
}

export function ExpiredScreen({ view }: { view: CheckoutView }) {
  return (
    <div className="text-center">
      <Icon bg="#fef3c7">⌛</Icon>
      <h2 className="mt-4 text-xl font-semibold text-amber-700">Payment expired</h2>
      <p className="mt-1 text-slate-600">
        This QR code is no longer valid. Please return to {view.merchant.name} and try again.
      </p>
    </div>
  );
}

export function CancelledScreen() {
  return (
    <div className="text-center">
      <Icon bg="#e2e8f0">🚫</Icon>
      <h2 className="mt-4 text-xl font-semibold text-slate-700">Payment cancelled</h2>
      <p className="mt-1 text-slate-600">This payment was cancelled by the merchant.</p>
    </div>
  );
}
