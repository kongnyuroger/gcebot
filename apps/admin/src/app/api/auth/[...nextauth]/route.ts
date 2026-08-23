import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// The credentials provider's authorize() calls out to the API server-side
// (POST /admin/auth/verify-totp) - on a free-tier host that sleeps when
// idle, that call alone can take 30-50s to wake it up. Vercel's default
// serverless function timeout (10s on the Hobby plan) would kill this
// route mid-request well before that, which surfaces to the user as a
// silent failure with no error message. 60s is the max allowed on Hobby.
export const maxDuration = 60;

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
