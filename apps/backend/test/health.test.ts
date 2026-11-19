import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb, ensureDatabase, migrateLatest, type Db } from '../src/db.js';
import { startTestDatabase, type TestDatabase } from './helpers/db.js';

describe('GET /api/health (AR-18) against a real MariaDB', () => {
  let testDb: TestDatabase;
  let db: Db;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestDatabase('health');
    await ensureDatabase(testDb.config);
    db = createDb(testDb.config);
    app = await buildApp({ config: testDb.config, db });
  });

  afterAll(async () => {
    await app?.close();
    await db?.raw('DROP DATABASE IF EXISTS ??', [testDb.config.db.database]).catch(() => {});
    await db?.destroy();
    await testDb?.stop();
  });

  it('reports 503 while migrations are pending', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', database: true });
    expect(res.json().migrations.pending).toBeGreaterThan(0);
  });

  it('reports ok after migrating an empty database', async () => {
    const applied = await migrateLatest(db);
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
    expect(await migrateLatest(db)).toEqual([]);
  });

  it('ensureDatabase is idempotent (AR-12)', async () => {
    await expect(ensureDatabase(testDb.config)).resolves.toBeUndefined();
  });

  it('serves an OpenAPI 3 document (AR-07)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toMatch(/^3\./);
    expect(Object.keys(res.json().paths)).toContain('/api/health');
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('reports 503 when the database is unreachable', async () => {
    const broken = createDb({ ...testDb.config, db: { ...testDb.config.db, port: 1 } });
    const brokenApp = await buildApp({ config: testDb.config, db: broken });
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
