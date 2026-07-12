'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Logo } from '@/components/Logo';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password }, auth: false });
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally { setLoading(false); }
  };

  if (!token) {
    return <p className="text-sm text-red-600">This reset link is missing its token. Request a new one from <Link href="/forgot-password" className="underline">Forgot password</Link>.</p>;
  }
  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">✓</div>
        <h1 className="text-lg font-semibold">Password updated</h1>
        <p className="mt-1 text-sm text-slate-500">Redirecting you to sign in…</p>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Set a new password</h1>
      <p className="mt-1 text-sm text-slate-500">Choose a strong password (at least 8 characters).</p>
      <form onSubmit={submit} className="mt-6 space-y-3.5">
        <label className="block"><span className="text-sm font-medium text-slate-700">New password</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>
        <label className="block"><span className="text-sm font-medium text-slate-700">Confirm password</span>
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-brand-500 py-2.5 font-semibold text-white shadow-brand hover:bg-brand-600 disabled:opacity-60">
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8"><Logo /></div>
        <Suspense fallback={<p className="text-slate-400">Loading…</p>}><ResetForm /></Suspense>
      </div>
    </main>
  );
}
