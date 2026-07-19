'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, tokenStore, orgStore } from '@/lib/api';
import { Logo } from '@/components/Logo';

interface VerifyResult {
  token: string;
  organization: { id: string; name: string };
}

function VerifyInner() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [status, setStatus] = useState<'verifying' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 double-invoke — the token is single-use
    ran.current = true;
    if (!token) {
      setStatus('error');
      setError('This confirmation link is missing its token.');
      return;
    }
    (async () => {
      try {
        const result = await api<VerifyResult>('/auth/verify-email', { method: 'POST', body: { token }, auth: false });
        tokenStore.set(result.token);
        if (result.organization?.id) orgStore.set(result.organization.id);
        router.replace('/overview');
      } catch (err) {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : 'Something went wrong confirming your email.');
      }
    })();
  }, [token, router]);

  if (status === 'verifying') {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-card">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
        <h1 className="text-lg font-semibold">Confirming your email…</h1>
        <p className="mt-1 text-sm text-slate-500">Activating your account and signing you in.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center shadow-card">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-2xl">!</div>
      <h1 className="text-lg font-semibold">Couldn&apos;t confirm your email</h1>
      <p className="mt-1 text-sm text-slate-500">{error}</p>
      <Link href="/login" className="mt-5 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
        Back to sign in
      </Link>
      <p className="mt-3 text-xs text-slate-400">From the sign-in page you can request a fresh confirmation link.</p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8"><Logo /></div>
        <Suspense fallback={<p className="text-slate-400">Loading…</p>}><VerifyInner /></Suspense>
      </div>
    </main>
  );
}
