import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { Sidebar } from '@/components/app-shell/sidebar';
import { TopBar } from '@/components/app-shell/topbar';

// middleware.ts already blocks unauthenticated requests to /admin/* - this is
// a cheap defense-in-depth check at the layout level too, mirroring the
// belt-and-suspenders guard pattern the NestJS API itself uses.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
