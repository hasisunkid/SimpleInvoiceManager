import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb, ensureDatabase, migrateLatest } from '../src/db.js';
import { createTestDatabase, type TestDatabase } from './helpers/db.js';

describe('GET /api/health (AR-18) against a real MariaDB', () => {
  let t: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    t = await createTestDatabase('health', { migrate: false });
    app = await buildApp({ config: t.config, db: t.db });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  it('reports 503 while migrations are pending', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', database: true });
    expect(res.json().migrations.pending).toBeGreaterThan(0);
  });

  it('reports ok after migrating an empty database (NFR-OPS-01)', async () => {
    const applied = await migrateLatest(t.db);
    expect(applied.length).toBeGreaterThan(0);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      database: true,
      migrations: { applied: applied.length, pending: 0 },
    });
  });

  it('migrations are idempotent (NFR-OPS-01)', async () => {
    expect(await migrateLatest(t.db)).toEqual([]);
  });

  it('ensureDatabase is idempotent (AR-12)', async () => {
    await expect(ensureDatabase(t.config)).resolves.toBeUndefined();
  });

  it('serves an OpenAPI 3 document without login (AR-07)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toMatch(/^3\./);
    expect(Object.keys(res.json().paths)).toEqual(
      expect.arrayContaining(['/api/health', '/api/auth/login', '/api/users']),
    );
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('reports 503 when the database is unreachable', async () => {
    const broken = createDb({ ...t.config, db: { ...t.config.db, port: 1 } });
    const brokenApp = await buildApp({ config: t.config, db: broken });
    try {
      const res = await brokenApp.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'error', database: false });
    } finally {
      await brokenApp.close();
      await broken.destroy();
    }
  });
});
