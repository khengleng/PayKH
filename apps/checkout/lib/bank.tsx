import React from 'react';

/**
 * Payer-facing "who you're paying" data, as returned by the API from the
 * merchant's imported KHQR.
 */
export interface Payee {
  name: string | null;
  account_id: string;
  bank_code: string | null;
  bank_name: string | null;
  account_type: 'merchant' | 'individual';
}

/**
 * Brand mark for a bank. We don't ship copyrighted logo images, so each bank is
 * shown as a wordmark badge in its brand colour — instantly recognisable and
 * CSP-safe. A real logo <img> can replace this later if the assets are on hand.
 */
const BRANDS: Record<string, { label: string; bg: string; fg?: string }> = {
  wing: { label: 'Wing', bg: '#00A94F' },
  aba: { label: 'ABA', bg: '#0A2472' },
  acleda: { label: 'ACLEDA', bg: '#004A97' },
  canadia: { label: 'Canadia', bg: '#E4002B' },
  cadi: { label: 'Canadia', bg: '#E4002B' },
  prince: { label: 'Prince', bg: '#7A1F2B' },
  phillipbank: { label: 'Phillip', bg: '#ED1C24' },
  phillip: { label: 'Phillip', bg: '#ED1C24' },
  sathapana: { label: 'Sathapana', bg: '#C8102E' },
  ftb: { label: 'FTB', bg: '#1B4B9B' },
  cpbank: { label: 'Campu', bg: '#004B87' },
  campubank: { label: 'Campu', bg: '#004B87' },
  vattanac: { label: 'Vattanac', bg: '#1A1A2E' },
  maybank: { label: 'Maybank', bg: '#FFC72C', fg: '#000' },
  chipmong: { label: 'Chip Mong', bg: '#D6001C' },
  amk: { label: 'AMK', bg: '#E4002B' },
  truemoney: { label: 'TrueMoney', bg: '#F26E21' },
  woori: { label: 'Woori', bg: '#0067AC' },
  wooribank: { label: 'Woori', bg: '#0067AC' },
  aeon: { label: 'AEON', bg: '#E5007E' },
};

function brandFor(code: string | null, fallbackLabel: string | null) {
  if (code && BRANDS[code]) return BRANDS[code];
  const label = (fallbackLabel ?? code ?? 'Bank').slice(0, 10);
  return { label, bg: '#475569', fg: '#fff' };
}

/** Small square brand badge for a bank. */
export function BankMark({ code, name, size = 40 }: { code: string | null; name: string | null; size?: number }) {
  const b = brandFor(code, name);
  const short = b.label.length <= 4 ? b.label : b.label.slice(0, 1);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-bold"
      style={{ background: b.bg, color: b.fg ?? '#fff', width: size, height: size, fontSize: size * 0.34 }}
      aria-label={name ?? 'Bank'}
    >
      {short}
    </div>
  );
}

/** "Paying to" card: bank mark + owner name + bank + masked account. */
export function PayeeCard({ payee, label = 'Paying to' }: { payee: Payee; label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <BankMark code={payee.bank_code} name={payee.bank_name} />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="truncate font-semibold text-slate-800">{payee.name ?? payee.account_id}</div>
        <div className="truncate text-xs text-slate-500">
          {payee.bank_name ?? 'Bank'} · <span className="font-mono">{payee.account_id}</span>
        </div>
      </div>
    </div>
  );
}
