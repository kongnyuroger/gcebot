const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  token: string;
  body?: unknown;
  // FormData (multipart uploads) must be passed through untouched - fetch
  // sets its own multipart boundary in the Content-Type header, which a
  // manual 'application/json' header would clobber.
  isFormData?: boolean;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const { token, body, isFormData, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}) as { message?: string });
    throw new ApiError(response.status, errorBody.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// Every call site attaches its own bearer token explicitly, rather than this
// module reaching into next-auth itself - it keeps this file usable from
// both Server Components (getServerSession) and Client Components
// (useSession(), via the useApiClient() hook below) without caring which.
export const apiClient = {
  get: <T>(path: string, token: string) => request<T>(path, { method: 'GET', token }),
  post: <T>(path: string, token: string, body?: unknown) =>
    request<T>(path, { method: 'POST', token, body }),
  patch: <T>(path: string, token: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', token, body }),
  delete: <T>(path: string, token: string) => request<T>(path, { method: 'DELETE', token }),
  postForm: <T>(path: string, token: string, formData: FormData) =>
    request<T>(path, { method: 'POST', token, body: formData, isFormData: true }),
};
