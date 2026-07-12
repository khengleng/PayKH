'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, tokenStore, orgStore } from '@/lib/api';
import { Logo, LogoMark } from '@/components/Logo';
import { useT, LangToggle } from '@/lib/i18n';

interface AuthResult {
  token: string;
  organization: { id: string; name: string };
}

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('owner@demo.paykh.dev');
  const [password, setPassword] = useState('Password123!');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, name, organizationName: orgName };
      const result = await api<AuthResult>(path, { method: 'POST', body, auth: false });
      tokenStore.set(result.token);
      if (result.organization?.id) orgStore.set(result.organization.id);
      const next = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
      if (next) { router.push(next); return; }
      // Platform admins land on the console (they have no merchant store).
      const me = await api<{ is_platform_admin?: boolean; organizations: unknown[] }>('/auth/me').catch(() => null);
      router.push(me?.is_platform_admin && me.organizations.length === 0 ? '/admin' : '/overview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen">
      {/* Brand panel */}
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-brand-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-90" style={{ backgroundImage: 'radial-gradient(40rem 40rem at 20% 10%, rgba(30,91,214,0.55), transparent 60%), radial-gradient(30rem 30rem at 90% 90%, rgba(86,135,250,0.35), transparent 60%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <LogoMark size={38} />
            <span className="text-2xl font-bold tracking-tight">pay<span className="text-brand-300">KH</span></span>
          </div>
        </div>
        <div className="relative">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">Pay Smart.<br />Grow Together.</h2>
          <p className="mt-4 max-w-md text-brand-100/80">The all-in-one KHQR payment platform for Cambodian merchants — payments, loyalty, campaigns, and AI insights in one place.</p>
          <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
            {[['⚡', 'Instant KHQR', 'Bakong-ready checkout'], ['🎁', 'Loyalty & games', 'Turn buyers into regulars'], ['🛡️', 'Bank-grade security', 'Encrypted, audited, reconciled'], ['✨', 'AI Copilot', 'Grow with recommendations']].map(([icon, t, d]) => (
              <div key={t} className="rounded-xl bg-white/10 p-3 backdrop-blur">
                <div className="text-lg">{icon}</div>
                <div className="mt-1 font-semibold">{t}</div>
                <div className="text-xs text-brand-100/70">{d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-brand-100/60">
          <span className="h-px w-6 bg-brand-100/30" /> Made for Cambodia 🇰🇭
        </div>
      </section>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between lg:justify-end">
            <span className="lg:hidden"><Logo /></span>
            <LangToggle />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{mode === 'login' ? t('welcome_back') : 'Create your account'}</h1>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? t('signin_sub') : 'Start accepting KHQR payments in minutes.'}</p>

          <form onSubmit={submit} className="mt-6 space-y-3.5">
            {mode === 'register' && (
              <>
                <Field label="Your name" value={name} onChange={setName} placeholder="Sok Dara" />
                <Field label="Organization" value={orgName} onChange={setOrgName} placeholder="My Company" />
              </>
            )}
            <Field label={t('email')} type="email" value={email} onChange={setEmail} required />
            <Field label={t('password')} type="password" value={password} onChange={setPassword} required />

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/10">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white shadow-brand transition-all hover:bg-brand-600 active:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Please wait…' : mode === 'login' ? t('signin') : 'Create account'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            className="mt-4 w-full text-center text-sm text-slate-500 hover:text-brand-600"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>

          {mode === 'login' && (
            <p className="mt-6 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-center text-xs text-slate-400">
              Demo: <span className="font-medium text-slate-500">owner@demo.paykh.dev</span> · pre-filled
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
      />
    </label>
  );
}
