'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';

export default function Index() {
  const router = useRouter();
  useEffect(() => {
    router.replace(tokenStore.get() ? '/overview' : '/login');
  }, [router]);
  return <div className="flex min-h-screen items-center justify-center text-slate-400">Redirecting…</div>;
}
