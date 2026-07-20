'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

interface ProvidersProps {
  children: React.ReactNode;
  session: Session | null;
}

// Seeded with a server-fetched session (see layout.tsx) so the client
// SessionProvider doesn't need its own extra round-trip to
// /api/auth/session on first paint.
export function Providers({ children, session }: ProvidersProps) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
