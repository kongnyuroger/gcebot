'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BroadcastComposer } from '@/components/broadcast/broadcast-composer';
import { BroadcastHistoryTable } from '@/components/broadcast/broadcast-history-table';

export default function BroadcastPage() {
  const { data: session } = useSession();
  const canSend = session?.user?.role === 'CONTENT_MANAGER' || session?.user?.role === 'SUPER_ADMIN';
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Broadcast</h1>

      {canSend ? (
        <BroadcastComposer onSent={() => setRefreshKey((key) => key + 1)} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sending is restricted</CardTitle>
            <CardDescription>Only content managers and super admins can send broadcasts.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      <BroadcastHistoryTable refreshKey={refreshKey} />
    </div>
  );
}
