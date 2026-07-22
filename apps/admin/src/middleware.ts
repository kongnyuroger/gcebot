import { withAuth } from 'next-auth/middleware';

// withAuth() runs in the Edge runtime, separate from the Node.js runtime
// that serves the NextAuth API route - it does NOT read authOptions' own
// `pages.signIn`, so the sign-in redirect target has to be repeated here
// explicitly or it silently falls back to NextAuth's default /api/auth/signin.
export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: ['/admin/:path*'],
};
