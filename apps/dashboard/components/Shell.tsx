'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, tokenStore, storeStore } from '@/lib/api';
import { Me, Store } from '@/lib/types';
import { Logo, LogoMark } from '@/components/Logo';
import { Icon } from '@/components/icons';
import { useT, LangToggle } from '@/lib/i18n';

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.paykh.cambobia.com';

const NAV_GROUPS: { title: string; items: { href: string; label: string; icon: string; external?: boolean }[] }[] = [
  {
    title: 'Operate',
    items: [
      { href: '/overview', label: 'Overview', icon: 'overview' },
      { href: '/payments', label: 'Payments', icon: 'payments' },
      { href: '/links', label: 'Payment Links', icon: 'links' },
      { href: '/pos', label: 'POS', icon: 'pos' },
      { href: '/settlements', label: 'Settlements', icon: 'settlements' },
      { href: '/ledger', label: 'Ledger', icon: 'ledger' },
    ],
  },
  {
    title: 'Grow',
    items: [
      { href: '/customers', label: 'Customers', icon: 'customers' },
      { href: '/loyalty', label: 'Loyalty', icon: 'loyalty' },
      { href: '/segments', label: 'Segments', icon: 'segments' },
      { href: '/campaigns', label: 'Campaigns', icon: 'campaigns' },
      { href: '/games', label: 'Games', icon: 'games' },
      { href: '/marketplace', label: 'Marketplace', icon: 'marketplace' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { href: '/reports', label: 'Reports', icon: 'reports' },
      { href: '/analytics', label: 'Analytics', icon: 'analytics' },
      { href: '/risk', label: 'Risk', icon: 'risk' },
      { href: '/copilot', label: 'AI Copilot', icon: 'copilot' },
    ],
  },
  {
    title: 'Build',
    items: [
      { href: '/keys', label: 'API Keys', icon: 'keys' },
      { href: '/webhooks', label: 'Webhooks', icon: 'webhooks' },
      { href: DOCS_URL, label: 'Documentation', icon: 'docs', external: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/stores', label: 'Stores', icon: 'stores' },
      { href: '/team', label: 'Team', icon: 'team' },
      { href: '/access', label: 'Access', icon: 'access' },
      { href: '/billing', label: 'Billing', icon: 'billing' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
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
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const reloadStores = async () => {
    const list = await api<Store[]>('/stores');
    setStores(list);
    const stored = storeStore.get();
    const next = list.find((s) => s.id === stored)?.id ?? list[0]?.id ?? null;
    setActiveId(next);
    if (next) storeStore.set(next);
  };

  useEffect(() => {
    if (!tokenStore.get()) { router.replace('/login'); return; }
    // Ignore results once this Shell is gone: navigating away rejects the
    // in-flight fetch, and acting on that would clear the session of the page
    // the user just moved to.
    let cancelled = false;
    (async () => {
      try {
        const meResult = await api<Me>('/auth/me');
        if (cancelled) return;
        setMe(meResult);
        await reloadStores();
        if (cancelled) return;
      } catch (e) {
        if (cancelled) return;
        // Only a real auth failure ends the session. This catch also covers
        // /stores and any network blip, and treating those as "logged out"
        // silently destroys a valid session — indistinguishable, to the user,
        // from being randomly signed out.
        if (e instanceof ApiError && e.status === 401) {
          tokenStore.clear();
          router.replace('/login');
        } else {
          setLoadError(e instanceof Error ? e.message : 'Could not reach the API');
        }
        return;
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A transient failure keeps the session and offers a retry, rather than
  // bouncing to /login and making a working login look expired.
  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <LogoMark size={40} />
          <p className="text-sm font-medium text-slate-700">Couldn’t load your workspace</p>
          <p className="text-sm text-slate-500">{loadError}</p>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600"
            >
              Retry
            </button>
            <button
              onClick={() => { tokenStore.clear(); router.replace('/login'); }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ready || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <LogoMark size={40} className="animate-pulse" />
          <span className="text-sm">{t('loading_ws')}</span>
        </div>
      </div>
    );
  }

  const activeStore = stores.find((s) => s.id === activeId) ?? null;
  const logout = () => { tokenStore.clear(); router.replace('/login'); };
  const initials = (me.email ?? '?').slice(0, 2).toUpperCase();

  const NavList = () => (
    <nav className="flex-1 space-y-5 overflow-y-auto">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t(`grp.${group.title}`)}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = !item.external && pathname === item.href;
              const className = `group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100/70'
              }`;
              const inner = (
                <>
                  {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-500" />}
                  <Icon name={item.icon} className={active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'} /> {t(`nav.${item.label}`)}
                  {item.external && <span className="ml-auto text-xs text-slate-300 group-hover:text-slate-400">↗</span>}
                </>
              );
              return item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                  className={className}
                >
                  {inner}
                </a>
              ) : (
                <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={className}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-slate-200 bg-white/80 px-4 py-5 backdrop-blur md:flex">
        <Link href="/overview" className="mb-6 px-2"><Logo /></Link>
        <NavList />
        {me.is_platform_admin && (
          <a href="/admin" className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <span>🛰️</span> {t('admin_console')}
          </a>
        )}
        <button onClick={logout} className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100">
          <span>↩</span> {t('signout')}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-white px-4 py-5 shadow-xl">
            <Link href="/overview" className="mb-6 px-2" onClick={() => setMobileOpen(false)}><Logo /></Link>
            <NavList />
            <button onClick={logout} className="mt-4 rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100">↩ Sign out</button>
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Menu">☰</button>
            <span className="md:hidden"><LogoMark size={26} /></span>
            {stores.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    value={activeId ?? ''}
                    onChange={(e) => { setActiveId(e.target.value); storeStore.set(e.target.value); }}
                    className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-slate-700 hover:border-slate-300"
                  >
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">▾</span>
                </div>
                {activeStore && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${activeStore.live_mode ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-amber-50 text-amber-700 ring-amber-600/20'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${activeStore.live_mode ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {activeStore.live_mode ? 'Live' : 'Test'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <LangToggle />
            <span className="hidden text-sm text-slate-500 sm:inline">{me.email}</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">{initials}</div>
          </div>
        </header>

        {/* Mobile bottom-nav removed in favor of the drawer; keep content roomy */}
        <main className="mx-auto w-full max-w-6xl flex-1 animate-fade-in p-4 md:p-6">{children({ me, stores, activeStore, reloadStores })}</main>
      </div>
    </div>
  );
}
