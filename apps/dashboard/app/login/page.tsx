'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, tokenStore, orgStore } from '@/lib/api';
import { Logo, LogoMark } from '@/components/Logo';
import { useT, LangToggle } from '@/lib/i18n';

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.paykh.cambobia.com';

interface AuthResult {
  token: string;
  organization: { id: string; name: string };
}

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // When set, we show the "check your email to confirm" screen for this address.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'register') {
        const r = await api<{ email: string }>('/auth/register', {
          method: 'POST',
          body: { email, password, name, organizationName: orgName },
          auth: false,
        });
        setPendingEmail(r.email || email);
        return;
      }
      const result = await api<AuthResult>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      tokenStore.set(result.token);
      if (result.organization?.id) orgStore.set(result.organization.id);
      const next = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
      if (next) { router.push(next); return; }
      // Platform admins land on the console (they have no merchant store).
      const me = await api<{ is_platform_admin?: boolean; organizations: unknown[] }>('/auth/me').catch(() => null);
      router.push(me?.is_platform_admin && me.organizations.length === 0 ? '/admin' : '/overview');
    } catch (err) {
      // An enrolled-but-unconfirmed account → show the confirm-email screen with a resend.
      if (err instanceof ApiError && err.code === 'email_unverified') {
        setPendingEmail(email);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!pendingEmail) return;
    setResending(true);
    setResendMsg(null);
    try {
      await api('/auth/resend-verification', { method: 'POST', body: { email: pendingEmail }, auth: false });
      setResendMsg('Confirmation email sent. Check your inbox (and spam).');
    } catch {
      setResendMsg('Could not resend right now — try again in a moment.');
    } finally {
      setResending(false);
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
            <div className="flex items-center gap-3">
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-brand-600">Docs ↗</a>
              <LangToggle />
            </div>
          </div>
          {pendingEmail ? (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Confirm your email</h1>
              <p className="mt-2 text-sm text-slate-600">
                We sent a confirmation link to <span className="font-medium text-slate-900">{pendingEmail}</span>.
                Click it to activate your account and sign in. The link expires in 24 hours.
              </p>
              {resendMsg && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-600/10">{resendMsg}</p>}
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="mt-5 w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white shadow-brand transition-all hover:bg-brand-600 disabled:opacity-60"
              >
                {resending ? 'Sending…' : 'Resend confirmation email'}
              </button>
              <button
                type="button"
                onClick={() => { setPendingEmail(null); setResendMsg(null); setMode('login'); }}
                className="mt-4 w-full text-center text-sm text-slate-500 hover:text-brand-600"
              >
                Back to sign in
              </button>
            </div>
          ) : (
          <>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{mode === 'login' ? t('welcome_back') : 'Enroll for demo access'}</h1>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? t('signin_sub') : 'Sign up to test PayKH — confirm your email to activate.'}</p>

          <form onSubmit={submit} className="mt-6 space-y-3.5">
            {mode === 'register' && (
              <>
                <Field label="Your name" value={name} onChange={setName} placeholder="Sok Dara" />
                <Field label="Organization" value={orgName} onChange={setOrgName} placeholder="My Company" />
              </>
            )}
            <Field label={t('email')} type="email" value={email} onChange={setEmail} required />
            <Field label={t('password')} type="password" value={password} onChange={setPassword} required />
            {mode === 'login' && (
              <div className="text-right"><a href="/forgot-password" className="text-xs text-slate-500 hover:text-brand-600">Forgot password?</a></div>
            )}

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/10">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white shadow-brand transition-all hover:bg-brand-600 active:bg-brand-700 disabled:opacity-60"
            >
              {loading ? 'Please wait…' : mode === 'login' ? t('signin') : 'Enroll'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            className="mt-4 w-full text-center text-sm text-slate-500 hover:text-brand-600"
          >
            {mode === 'login' ? 'Want to test PayKH? Enroll for demo access' : 'Already have an account? Sign in'}
          </button>
          </>
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
