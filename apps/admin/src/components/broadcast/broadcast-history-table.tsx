'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApiClient } from '@/lib/use-api-client';
import type { Broadcast, BroadcastStatus, PaginatedBroadcasts } from '@/lib/broadcast-types';

interface BroadcastHistoryTableProps {
  refreshKey: number;
}

const STATUS_VARIANT: Record<BroadcastStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  SCHEDULED: 'outline',
  PROCESSING: 'secondary',
  COMPLETE: 'default',
  FAILED: 'destructive',
};

function describeTarget(broadcast: Broadcast): string {
  if (broadcast.target === 'ALL') return 'All users';
  return `${broadcast.target}: ${broadcast.targetValue}`;
}

export function BroadcastHistoryTable({ refreshKey }: BroadcastHistoryTableProps) {
  const api = useApiClient();
  const [data, setData] = useState<PaginatedBroadcasts | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    api.get<PaginatedBroadcasts>(`/admin/broadcast/history?page=${page}`).then((result) => {
      if (!cancelled) setData(result);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Message</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Delivered</th>
              <th className="px-4 py-3 font-medium">Scheduled</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {data && data.broadcasts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No broadcasts sent yet.
                </td>
              </tr>
            )}
            {data?.broadcasts.map((broadcast) => (
              <tr key={broadcast.id} className="border-t align-top">
                <td className="max-w-xs truncate px-4 py-3" title={broadcast.message}>
                  {broadcast.message}
                </td>
                <td className="px-4 py-3">{describeTarget(broadcast)}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[broadcast.status]}>{broadcast.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  {broadcast.sentCount}/{broadcast.totalRecipients}
                  {broadcast.failedCount > 0 ? ` (${broadcast.failedCount} failed)` : ''}
                </td>
                <td className="px-4 py-3">
                  {broadcast.scheduleAt ? new Date(broadcast.scheduleAt).toLocaleString() : 'Immediate'}
                </td>
                <td className="px-4 py-3">{new Date(broadcast.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} broadcasts)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
