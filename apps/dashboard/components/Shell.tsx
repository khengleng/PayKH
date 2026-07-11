'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, tokenStore, storeStore } from '@/lib/api';
import { Me, Store } from '@/lib/types';

const NAV = [
  { href: '/overview', label: 'Overview', icon: '📊' },
  { href: '/payments', label: 'Payments', icon: '💳' },
  { href: '/customers', label: 'Customers', icon: '👤' },
  { href: '/segments', label: 'Segments', icon: '🎯' },
  { href: '/campaigns', label: 'Campaigns', icon: '📣' },
  { href: '/games', label: 'Games', icon: '🎰' },
  { href: '/reports', label: 'Reports', icon: '📈' },
  { href: '/analytics', label: 'Analytics', icon: '🔮' },
  { href: '/risk', label: 'Risk', icon: '🛡️' },
  { href: '/copilot', label: 'Copilot', icon: '✨' },
  { href: '/settlements', label: 'Settlements', icon: '🏦' },
  { href: '/keys', label: 'API Keys', icon: '🔑' },
  { href: '/webhooks', label: 'Webhooks', icon: '🔔' },
  { href: '/team', label: 'Team', icon: '👥' },
  { href: '/billing', label: 'Billing', icon: '💠' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
  { href: '/stores', label: 'Stores', icon: '🏬' },
];

export interface ShellContext {
  me: Me;
  stores: Store[];
  activeStore: Store | null;
  reloadStores: () => Promise<void>;
}

export function Shell({ children }: { children: (ctx: ShellContext) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const reloadStores = async () => {
    const list = await api<Store[]>('/stores');
    setStores(list);
    const stored = storeStore.get();
    const next = list.find((s) => s.id === stored)?.id ?? list[0]?.id ?? null;
    setActiveId(next);
    if (next) storeStore.set(next);
  };

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const meResult = await api<Me>('/auth/me');
        setMe(meResult);
        await reloadStores();
      } catch {
        tokenStore.clear();
        router.replace('/login');
        return;
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || !me) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  const activeStore = stores.find((s) => s.id === activeId) ?? null;

  const logout = () => {
    tokenStore.clear();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 font-bold text-white">P</div>
          <span className="font-semibold">PayKH</span>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{item.icon}</span> {item.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="mt-4 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">
          Sign out
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            {/* mobile nav */}
            <div className="flex gap-1 md:hidden">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-2 py-1 text-lg">
                  {item.icon}
                </Link>
              ))}
            </div>
            {stores.length > 0 && (
              <select
                value={activeId ?? ''}
                onChange={(e) => {
                  setActiveId(e.target.value);
                  storeStore.set(e.target.value);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.live_mode ? '(live)' : '(test)'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="text-sm text-slate-500">{me.email}</div>
        </header>

        <main className="mx-auto max-w-5xl p-6">{children({ me, stores, activeStore, reloadStores })}</main>
      </div>
    </div>
  );
}
