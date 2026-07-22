'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApiClient } from '@/lib/use-api-client';
import { maskPhone, SUBSCRIPTION_TIERS, type PaginatedUsers } from '@/lib/users-types';

interface UsersTableProps {
  onSelectUser: (phone: string) => void;
  refreshKey: number;
}

export function UsersTable({ onSelectUser, refreshKey }: UsersTableProps) {
  const api = useApiClient();
  const [data, setData] = useState<PaginatedUsers | null>(null);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('search', search);
      if (tierFilter) params.set('tier', tierFilter);

      const result = await api.get<PaginatedUsers>(`/admin/users?${params.toString()}`);
      if (!cancelled) setData(result);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tierFilter, page, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Input
          placeholder="Search by phone number"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          aria-label="Filter by tier"
          value={tierFilter}
          onChange={(event) => {
            setPage(1);
            setTierFilter(event.target.value);
          }}
          className="w-40"
        >
          <option value="">All tiers</option>
          {SUBSCRIPTION_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Subjects</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Streak</th>
              <th className="px-4 py-3 font-medium">Last active</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {data && data.users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            )}
            {data?.users.map((user) => (
              <tr
                key={user.phone_number}
                className="cursor-pointer border-t hover:bg-accent/50"
                onClick={() => onSelectUser(user.phone_number)}
              >
                <td className="px-4 py-3 font-mono">{maskPhone(user.phone_number)}</td>
                <td className="px-4 py-3">{user.level}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.subjects.map((subject) => (
                      <Badge key={subject} variant="secondary">
                        {subject}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge>{user.tier}</Badge>
                </td>
                <td className="px-4 py-3">{user.streakDays}</td>
                <td className="px-4 py-3">
                  {user.lastActiveDate ? new Date(user.lastActiveDate).toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-3">{new Date(user.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} users)
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
