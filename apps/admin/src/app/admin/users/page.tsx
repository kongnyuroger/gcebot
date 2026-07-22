'use client';

import { useState } from 'react';
import { UsersTable } from '@/components/users/users-table';
import { UserDetailDrawer } from '@/components/users/user-detail-drawer';

export default function UsersPage() {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <UsersTable onSelectUser={setSelectedPhone} refreshKey={refreshKey} />
      <UserDetailDrawer
        phone={selectedPhone}
        onClose={() => setSelectedPhone(null)}
        onTierUpdated={() => setRefreshKey((key) => key + 1)}
      />
    </div>
  );
}
