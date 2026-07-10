'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import { Button, Card } from '@/components/ui';

function InviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!tokenStore.get()) {
      // Not logged in — send to login, preserving the invite token.
      router.replace(`/login?next=${encodeURIComponent(`/invite?token=${token ?? ''}`)}`);
    }
  }, [router, token]);

  const accept = async () => {
    if (!token) return;
    setStatus('accepting');
    try {
      await api('/team/invitations/accept', { method: 'POST', body: { token } });
      setStatus('done');
      setTimeout(() => router.replace('/overview'), 1200);
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message ?? 'Could not accept invitation');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">Team invitation</h1>
        {!token ? (
          <p className="mt-2 text-sm text-slate-500">Missing invitation token.</p>
        ) : status === 'done' ? (
          <p className="mt-2 text-sm text-emerald-600">Joined! Redirecting…</p>
        ) : status === 'error' ? (
          <p className="mt-2 text-sm text-red-600">{message}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-500">Accept this invitation to join the organization.</p>
            <div className="mt-4">
              <Button onClick={accept} disabled={status === 'accepting'}>
                {status === 'accepting' ? 'Accepting…' : 'Accept invitation'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading…</div>}>
      <InviteInner />
    </Suspense>
  );
}
