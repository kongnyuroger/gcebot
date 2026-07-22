import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function AdminHomePage() {
  const session = await getServerSession(authOptions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome{session?.user?.email ? `, ${session.user.email}` : ''}</CardTitle>
        <CardDescription>Use the sidebar to manage documents, users, analytics, and broadcasts.</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
