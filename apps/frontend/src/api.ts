import type { Language } from '@sim/i18n';

/**
 * API client. All calls use document-relative paths (`api/...`, no leading slash), so they
 * resolve under the Home Assistant ingress path as well as at "/" (AR-13).
 */

export type Role = 'USER' | 'ADMIN';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  uiLanguage: Language | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  user: PublicUser | null;
  csrfToken: string | null;
}

export interface Health {
  status: 'ok' | 'error';
  database: boolean;
  migrations: { applied: number; pending: number };
}

/** Error with the server's machine-readable code (translated via `errors.<code>`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | undefined;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called when a protected request answers 401 (session expired or ended elsewhere). */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // FR-AUTH-07: every state-changing request carries the CSRF token (any value before login).
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken ?? 'anonymous';

  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    (T & { error?: string; message?: string; retryAfterSeconds?: number }) | null;
  if (!res.ok) {
    const code = data?.error ?? 'UNKNOWN';
    if (res.status === 401 && code === 'UNAUTHENTICATED') onUnauthenticated?.();
    throw new ApiError(res.status, code, data?.message ?? res.statusText, data?.retryAfterSeconds);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => apiRequest<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => apiRequest<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => apiRequest<T>('PATCH', path, body),
};
