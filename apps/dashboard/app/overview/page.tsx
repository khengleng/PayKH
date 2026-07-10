'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, PageTitle, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { Overview } from '@/lib/types';

export default function OverviewPage() {
  return (
    <Shell>
      {({ activeStore }) => {
        if (!activeStore) {
          return (
            <Card>
              <p className="text-slate-600">
                You don’t have a store yet. Create one under <strong>Stores</strong> to get started.
              </p>
            </Card>
          );
        }
        return <OverviewContent storeId={activeStore.id} live={activeStore.live_mode} />;
      }}
    </Shell>
  );
}

function OverviewContent({ storeId, live }: { storeId: string; live: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Overview>(`/dashboard/stores/${storeId}/overview`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [storeId]);

  return (
    <>
      <PageTitle
        title="Overview"
        subtitle={live ? 'Live mode' : 'Test mode — payments use the mock provider'}
      />
      {error && <Card className="text-red-600">{error}</Card>}
      {!data ? (
        <div className="text-slate-400">Loading metrics…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Total payments" value={data.total_payments} />
            <Stat label="Paid" value={data.paid_count} hint={`${data.success_rate}% success`} />
            <Stat label="Paid volume" value={`$${data.paid_volume}`} />
            <Stat label="This month (paid)" value={data.month_paid_count} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Pending" value={data.pending_count} />
            <Stat label="Failed" value={data.failed_count} />
            <Stat label="Expired" value={data.expired_count} />
            <Stat label="Webhook failures" value={data.recent_webhook_failures} hint="Phase 2" />
          </div>
        </>
      )}
    </>
  );
}
