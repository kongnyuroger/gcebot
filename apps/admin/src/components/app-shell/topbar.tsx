'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TopBar() {
  const { data: session } = useSession();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{session?.user?.email}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </header>
  );
}
