'use client';

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'km';
const KEY = 'paykh_lang';
const listeners = new Set<() => void>();

// Merchant dashboard defaults to English; toggle to Khmer persists per device.
function read(): Lang {
  if (typeof window === 'undefined') return 'en';
  return (localStorage.getItem(KEY) as Lang) || 'en';
}
export function setLang(l: Lang) { localStorage.setItem(KEY, l); listeners.forEach((f) => f()); }
function subscribe(f: () => void) { listeners.add(f); return () => listeners.delete(f); }
export function useLang(): Lang { return useSyncExternalStore(subscribe, read, () => 'en'); }

const DICT: Record<string, { en: string; km: string }> = {
  // nav groups
  'grp.Operate': { en: 'Operate', km: 'ប្រតិបត្តិការ' },
  'grp.Grow': { en: 'Grow', km: 'ការរីកចម្រើន' },
  'grp.Intelligence': { en: 'Intelligence', km: 'បញ្ញាវិភាគ' },
  'grp.Build': { en: 'Build', km: 'អ្នកអភិវឌ្ឍន៍' },
  'grp.Account': { en: 'Account', km: 'គណនី' },
  // nav items
  'nav.Overview': { en: 'Overview', km: 'ទិដ្ឋភាពទូទៅ' },
  'nav.Payments': { en: 'Payments', km: 'ការទូទាត់' },
  'nav.Payment Links': { en: 'Payment Links', km: 'តំណទូទាត់' },
  'nav.POS': { en: 'POS', km: 'ម៉ាស៊ីនគិតលុយ' },
  'nav.Settlements': { en: 'Settlements', km: 'ការទូទាត់សង' },
  'nav.Ledger': { en: 'Ledger', km: 'បញ្ជីគណនី' },
  'nav.Customers': { en: 'Customers', km: 'អតិថិជន' },
  'nav.Segments': { en: 'Segments', km: 'ក្រុមអតិថិជន' },
  'nav.Loyalty': { en: 'Loyalty', km: 'ភក្ដីភាព' },
  'nav.Campaigns': { en: 'Campaigns', km: 'យុទ្ធនាការ' },
  'nav.Games': { en: 'Games', km: 'ហ្គេម' },
  'nav.Marketplace': { en: 'Marketplace', km: 'ផ្សារកម្មវិធី' },
  'nav.Reports': { en: 'Reports', km: 'របាយការណ៍' },
  'nav.Analytics': { en: 'Analytics', km: 'ការវិភាគ' },
  'nav.Risk': { en: 'Risk', km: 'ហានិភ័យ' },
  'nav.AI Copilot': { en: 'AI Copilot', km: 'ជំនួយ AI' },
  'nav.API Keys': { en: 'API Keys', km: 'API Keys' },
  'nav.Webhooks': { en: 'Webhooks', km: 'Webhooks' },
  'nav.Documentation': { en: 'Documentation', km: 'ឯកសារ​សម្រាប់​អ្នក​អភិវឌ្ឍន៍' },
  'nav.Stores': { en: 'Stores', km: 'ហាង' },
  'nav.Team': { en: 'Team', km: 'ក្រុមការងារ' },
  'nav.Access': { en: 'Access', km: 'សិទ្ធិចូលប្រើ' },
  'nav.Billing': { en: 'Billing', km: 'វិក្កយបត្រ' },
  'nav.Settings': { en: 'Settings', km: 'ការកំណត់' },
  // shell / auth
  'signout': { en: 'Sign out', km: 'ចាកចេញ' },
  'admin_console': { en: 'Admin Console', km: 'កុងសូលអ្នកគ្រប់គ្រង' },
  'loading_ws': { en: 'Loading your workspace…', km: 'កំពុងផ្ទុកកន្លែងធ្វើការ…' },
  'welcome_back': { en: 'Welcome back', km: 'សូមស្វាគមន៍ការត្រឡប់មកវិញ' },
  'signin_sub': { en: 'Sign in to your merchant dashboard.', km: 'ចូលទៅផ្ទាំងគ្រប់គ្រងអាជីវកម្មរបស់អ្នក។' },
  'signin': { en: 'Sign in', km: 'ចូល' },
  'email': { en: 'Email', km: 'អ៊ីមែល' },
  'password': { en: 'Password', km: 'ពាក្យសម្ងាត់' },
};

export function useT() {
  const lang = useLang();
  return (k: string): string => DICT[k]?.[lang] ?? k;
}

export function LangToggle() {
  const lang = useLang();
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-slate-200 text-xs">
      {(['en', 'km'] as Lang[]).map((l) => (
        <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 font-medium ${lang === l ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
          {l === 'km' ? 'ខ្មែរ' : 'EN'}
        </button>
      ))}
    </div>
  );
}
