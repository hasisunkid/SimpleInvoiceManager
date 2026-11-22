import { vi } from 'vitest';
import type { PublicUser } from '../src/api';

type Handler = (init: RequestInit) => { status?: number; body?: unknown };

/** Stubs fetch with handlers keyed by "METHOD path", e.g. "POST api/auth/login". */
export function mockFetch(handlers: Record<string, Handler>) {
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    const { status = 200, body } = handler(init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function user(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 1,
    username: 'anna',
    displayName: 'Anna Góralewicz',
    role: 'USER',
    uiLanguage: null,
    active: true,
    mustChangePassword: false,
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  };
}

export const healthOk = () => ({
  body: {
    status: 'ok',
    database: true,
    migrations: { applied: 2, pending: 0 },
    version: '0.8.0',
    releaseNotesUrl: 'https://github.com/hasisunkid/SimpleInvoiceManager/releases/tag/v0.8.0',
  },
});
export const noSession = () => ({ body: { user: null, csrfToken: null } });
