'use client';

import { useSession } from 'next-auth/react';
import { apiClient } from './api-client';

// Thin convenience wrapper for Client Components: reads the bearer token
// from the current next-auth session so callers don't each have to.
// Server Components should call apiClient directly with a token from
// getServerSession() instead (no React hooks available there).
export function useApiClient() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? '';

  return {
    get: <T,>(path: string) => apiClient.get<T>(path, token),
    post: <T,>(path: string, body?: unknown) => apiClient.post<T>(path, token, body),
    patch: <T,>(path: string, body?: unknown) => apiClient.patch<T>(path, token, body),
    delete: <T,>(path: string) => apiClient.delete<T>(path, token),
    postForm: <T,>(path: string, formData: FormData) => apiClient.postForm<T>(path, token, formData),
  };
}
