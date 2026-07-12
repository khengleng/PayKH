'use client';

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'km';
const KEY = 'paykh_lang';
const listeners = new Set<() => void>();

// Customer-facing pages default to Khmer (Cambodia); toggle persists per device.
function read(): Lang {
  if (typeof window === 'undefined') return 'km';
  return (localStorage.getItem(KEY) as Lang) || 'km';
}
export function setLang(l: Lang) {
  localStorage.setItem(KEY, l);
  listeners.forEach((f) => f());
}
function subscribe(f: () => void) { listeners.add(f); return () => listeners.delete(f); }
export function useLang(): Lang { return useSyncExternalStore(subscribe, read, () => 'km'); }

const DICT = {
  pay_with_khqr: { en: 'Pay with KHQR', km: 'បង់ប្រាក់ជាមួយ KHQR' },
  scan_to_pay: { en: 'Scan to pay with any Bakong app', km: 'ស្កេនដើម្បីបង់ប្រាក់ជាមួយកម្មវិធី Bakong' },
  amount: { en: 'Amount', km: 'ចំនួនទឹកប្រាក់' },
  your_name: { en: 'Your name (optional)', km: 'ឈ្មោះរបស់អ្នក (មិនចាំបាច់)' },
  name: { en: 'Name', km: 'ឈ្មោះ' },
  starting: { en: 'Starting…', km: 'កំពុងចាប់ផ្ដើម…' },
  paid_already: { en: 'This has already been paid. Thank you!', km: 'វាបានបង់ប្រាក់រួចហើយ។ សូមអរគុណ!' },
  not_active: { en: 'This link is no longer active.', km: 'តំណនេះលែងដំណើរការទៀតហើយ។' },
  invoice: { en: 'INVOICE', km: 'វិក្កយបត្រ' },
  secured_by: { en: 'Secured by', km: 'ការពារដោយ' },
  paid: { en: 'Paid', km: 'បានបង់ប្រាក់' },
  payment_received: { en: 'Payment received', km: 'បានទទួលការបង់ប្រាក់' },
  thank_you: { en: 'Thank you for your payment to', km: 'សូមអរគុណសម្រាប់ការបង់ប្រាក់ទៅ' },
  receipt_no: { en: 'Receipt no.', km: 'លេខវិក្កយបត្រ' },
  reference: { en: 'Reference', km: 'លេខយោង' },
  date: { en: 'Date', km: 'កាលបរិច្ឆេទ' },
  print_save: { en: 'Print / Save PDF', km: 'បោះពុម្ព / រក្សាទុក PDF' },
  questions_contact: { en: 'Questions? Contact', km: 'មានសំណួរ? ទាក់ទង' },
  waiting_scan: { en: 'Waiting for the customer to scan…', km: 'កំពុងរង់ចាំអតិថិជនស្កេន…' },
  not_found: { en: 'Not found.', km: 'រកមិនឃើញ។' },
  scan_bank_app: { en: 'Scan with any Bakong-enabled banking app', km: 'ស្កេនជាមួយកម្មវិធីធនាគារដែលភ្ជាប់ Bakong' },
  refresh_status: { en: 'Refresh status', km: 'ធ្វើឲ្យទាន់សម័យ' },
  status: { en: 'Status', km: 'ស្ថានភាព' },
  expires_in: { en: 'Expires in', km: 'ផុតកំណត់ក្នុង' },
  qr_scanned: { en: 'QR scanned — awaiting confirmation…', km: 'បានស្កេន QR — កំពុងរង់ចាំការបញ្ជាក់…' },
} as const;

export function useT() {
  const lang = useLang();
  return (k: keyof typeof DICT): string => DICT[k]?.[lang] ?? k;
}

/** KHR-first money: Riel shows no decimals + ៛; USD shows $ with 2 decimals. */
export function money(amount: string | number, currency: string): string {
  const n = Number(amount);
  if (currency === 'KHR') return `${Math.round(n).toLocaleString()} ៛`;
  return `$${n.toFixed(2)}`;
}

export function LangToggle({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={`inline-flex overflow-hidden rounded-full border border-white/30 text-xs ${className}`}>
      {(['km', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{ padding: '3px 10px', fontWeight: 600, background: lang === l ? 'rgba(255,255,255,0.9)' : 'transparent', color: lang === l ? '#1E5BD6' : 'inherit' }}
        >
          {l === 'km' ? 'ខ្មែរ' : 'EN'}
        </button>
      ))}
    </div>
  );
}
