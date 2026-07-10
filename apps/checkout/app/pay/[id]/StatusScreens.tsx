'use client';

import { CheckoutView } from './types';

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

export function SuccessScreen({ view }: { view: CheckoutView }) {
  return (
    <div className="text-center">
      <Icon bg="#dcfce7">✅</Icon>
      <h2 className="mt-4 text-xl font-semibold text-emerald-700">Payment successful</h2>
      <p className="mt-1 text-slate-600">
        {view.amount} {view.currency} paid to {view.merchant.name}.
      </p>
      {view.merchant.custom_message && (
        <p className="mt-2 text-sm text-slate-500">{view.merchant.custom_message}</p>
      )}
      {view.merchant.success_url && (
        <a
          className="mt-6 inline-block rounded-lg px-5 py-2.5 font-medium text-white"
          style={{ background: view.merchant.primary_color }}
          href={view.merchant.success_url}
        >
          Continue
        </a>
      )}
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
