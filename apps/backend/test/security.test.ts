import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CONTENT_SECURITY_POLICY } from '../src/security-headers.js';
import { createTestApp, type TestApp } from './helpers/setup.js';
import { TestClient } from './helpers/client.js';

/**
 * NFR-SEC-01 "authorization check on every endpoint": the test walks the real route table, so a
 * route added later without protection breaks the build.
 */
let ctx: TestApp;

beforeAll(async () => {
  ctx = await createTestApp('security');
});
afterAll(async () => ctx?.close());

/** The only routes reachable without a session. */
const EXPECTED_PUBLIC = [
  'GET /api/auth/session',
  'GET /api/health',
  'GET /api/openapi.json',
  'POST /api/auth/login',
  'POST /api/auth/logout',
];

/** Administrator-only routes (FR-AUTH-04, D6, FR-NUM-*, NFR-DATA-02). */
const EXPECTED_ADMIN_PREFIXES = ['/api/users', '/api/settings/', '/api/admin/'];

function apiRoutes() {
  return ctx.app.routeTable.filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD');
}

const concrete = (url: string) => url.replace(/:[A-Za-z]+/g, '1');

describe('authorization on every endpoint (NFR-SEC-01, TR-02)', () => {
  it('has exactly the expected public routes', () => {
    const publicRoutes = apiRoutes()
      .filter((r) => r.public)
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(publicRoutes).toEqual(EXPECTED_PUBLIC);
  });

  it('marks exactly the admin areas as admin-only', () => {
    for (const route of apiRoutes()) {
      const adminArea = EXPECTED_ADMIN_PREFIXES.some((prefix) => route.url.startsWith(prefix));
      expect(route.admin, `${route.method} ${route.url}`).toBe(adminArea);
    }
  });

  it('answers 401 without a session on every protected route', async () => {
    const anonymous = new TestClient(ctx.app);
    const protectedRoutes = apiRoutes().filter((r) => !r.public);
    expect(protectedRoutes.length).toBeGreaterThan(30);
    for (const route of protectedRoutes) {
      const res = await anonymous.request(
        route.method as 'GET',
        concrete(route.url),
        route.method === 'GET' ? undefined : {},
      );
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('answers 403 to normal users on every admin route', async () => {
    for (const route of apiRoutes().filter((r) => r.admin)) {
      const res = await ctx.user.request(
        route.method as 'GET',
        concrete(route.url),
        route.method === 'GET' ? undefined : {},
      );
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
    }
  });
});

describe('secure headers (NFR-SEC-01)', () => {
  it('sends CSP and friends on API and page responses', async () => {
    for (const url of ['/api/health', '/api/does-not-exist']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      // Home Assistant Ingress embeds the app in an iframe on the same origin.
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('same-origin');
    }
  });

  it('allows no scripts from elsewhere and no inline scripts', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline');
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'self'");
  });

  it('does not reveal internals in error responses', async () => {
    const res = await ctx.user.get('/api/invoices/not-a-number');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/stack|at \w+ \(|node_modules/);
  });
});

describe('general request limit (NFR-SEC-01)', () => {
  it('limits each session separately and answers in the API error format', async () => {
    const app = await buildApp({ config: ctx.t.config, db: ctx.t.db, apiRateLimit: 3 });
    try {
      const login = async (username: string, password: string) => {
        const client = new TestClient(app);
        expect((await client.login(username, password)).statusCode).toBe(200);
        return client;
      };
      const anna = await login('worker', 'worker-password-final');
      const admin = await login('admin', 'admin-password-final');
      // Login counted as anonymous (IP); from now on each session has its own budget.
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await anna.get('/api/customers')).statusCode);
      expect(statuses).toEqual([200, 200, 200, 429]);
      const limited = await anna.get('/api/customers');
      expect(limited.json()).toMatchObject({ error: 'TOO_MANY_REQUESTS' });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      // Another person behind the same (Ingress) address is not affected.
      expect((await admin.get('/api/customers')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('does not count static files', async () => {
    const app = await buildApp({ config: ctx.t.config, db: ctx.t.db, apiRateLimit: 1 });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: 'GET', url: '/index.html' });
        expect(res.statusCode).not.toBe(429);
      }
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).not.toBe(429);
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
