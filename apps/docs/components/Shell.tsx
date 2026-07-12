'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';
import { NAV, FLAT_NAV } from '../lib/nav';

const DASHBOARD_URL = 'https://paykh.cambobia.com';

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close mobile nav on route change.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Cmd/Ctrl-K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <button className="lg:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <Link href="/"><Logo /></Link>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-300 sm:flex"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            Search
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-medium">⌘K</kbd>
          </button>
          <a href={`${DASHBOARD_URL}/login`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-brand hover:bg-brand-700">Get API keys</a>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* Sidebar */}
        <aside className={`${mobileOpen ? 'block' : 'hidden'} fixed inset-x-0 top-14 z-20 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-slate-100 bg-white px-4 py-4 lg:sticky lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r`}>
          <nav className="space-y-6 pb-10">
            {NAV.map((group) => (
              <div key={group.label}>
                <div className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block rounded-md px-2 py-1.5 text-sm ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 px-4 py-10 lg:px-12">
          <article className="prose mx-auto max-w-3xl animate-fade-in">{children}</article>
          <Footer />
        </main>
      </div>

      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function Footer() {
  return (
    <footer className="mx-auto mt-16 max-w-3xl border-t border-slate-100 pt-6 text-sm text-slate-400">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} PayKH · Bakong KHQR payments</span>
        <div className="flex gap-4">
          <a href="https://paykh.cambobia.com" className="hover:text-slate-600">Dashboard</a>
          <a href="/api-reference" className="hover:text-slate-600">API</a>
          <a href="/changelog" className="hover:text-slate-600">Changelog</a>
        </div>
      </div>
    </footer>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return FLAT_NAV;
    return FLAT_NAV.filter((i) => (i.title + ' ' + (i.keywords ?? '')).toLowerCase().includes(term));
  }, [q]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the docs…"
          className="w-full border-b border-slate-100 px-4 py-3.5 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-y-auto p-2">
          {results.map((i) => (
            <li key={i.href}>
              <Link href={i.href} onClick={onClose} className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700">
                {i.title}
              </Link>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
