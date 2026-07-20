import type { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const SESSION_MAX_AGE_SECONDS = 4 * 60 * 60; // 4 hours
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

interface VerifyTotpResponse {
  token: string;
  admin: { id: string; email: string; role: string };
}

// Deliberately only handles the SECOND half of login (tempToken + TOTP code).
// The first half (email + password -> tempToken) is a plain, unauthenticated
// fetch the login page makes directly to POST /admin/auth/login, before
// next-auth's signIn() is ever called - there's no real "session" to create
// until the TOTP code is verified, so that step doesn't belong in a
// credentials provider at all.
export const authOptions: AuthOptions = {
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Admin TOTP',
      credentials: {
        tempToken: { label: 'Temp Token', type: 'text' },
        code: { label: 'Authentication Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.tempToken || !credentials?.code) {
          return null;
        }

        const response = await fetch(`${API_BASE_URL}/admin/auth/verify-totp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tempToken: credentials.tempToken, code: credentials.code }),
        });

        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as VerifyTotpResponse;

        return {
          id: data.admin.id,
          email: data.admin.email,
          role: data.admin.role,
          accessToken: data.token,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.accessToken = user.accessToken;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
      }
      session.accessToken = token.accessToken;
      return session;
    },
  },
};
