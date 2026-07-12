'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Logo } from '@/components/Logo';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try { await api('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }); } catch { /* always succeed (no enumeration) */ }
    setSent(true); setLoading(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8"><Logo /></div>
        {sent ? (
          <div className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl">📬</div>
            <h1 className="text-lg font-semibold">Check your email</h1>
            <p className="mt-1 text-sm text-slate-500">If an account exists for <b>{email}</b>, we’ve sent a password-reset link. It expires in 1 hour.</p>
            <Link href="/login" className="mt-4 inline-block text-sm text-brand-600 hover:underline">← Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Forgot your password?</h1>
            <p className="mt-1 text-sm text-slate-500">Enter your email and we’ll send you a reset link.</p>
            <form onSubmit={submit} className="mt-6 space-y-3.5">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" />
              </label>
              <button type="submit" disabled={loading} className="w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white shadow-brand hover:bg-brand-600 disabled:opacity-60">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <Link href="/login" className="mt-4 block text-center text-sm text-slate-500 hover:text-brand-600">← Back to sign in</Link>
          </>
        )}
      </div>
    </main>
  );
}
