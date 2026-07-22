import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { Providers } from '@/components/providers';
import { authOptions } from '@/lib/auth-options';
import './globals.css';

export const metadata: Metadata = {
  title: 'GCEBot Admin',
  description: 'GCEBot Cameroon admin portal',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
