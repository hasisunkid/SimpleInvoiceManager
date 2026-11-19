import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { extractText, getDocumentProxy } from 'unpdf';
import { buildApp } from '../../src/app.js';
import { ensureInitialAdmin } from '../../src/users/bootstrap.js';
import { createTestDatabase, type TestDatabase } from './db.js';
import { TestClient } from './client.js';

export interface TestApp {
  readonly t: TestDatabase;
  readonly app: FastifyInstance;
  /** Logged-in administrator (password already changed). */
  readonly admin: TestClient;
  /** Logged-in normal user (password already changed). */
  readonly user: TestClient;
  close(): Promise<void>;
}

async function readyClient(app: FastifyInstance, username: string, first: string) {
  const client = new TestClient(app);
  expect((await client.login(username, first)).statusCode).toBe(200);
  const res = await client.put('/api/me/password', {
    currentPassword: first,
    newPassword: `${username}-password-final`,
  });
  expect(res.statusCode).toBe(200);
  return client;
}

/** Fresh database + app with one admin and one normal user, both logged in. */
export async function createTestApp(name: string): Promise<TestApp> {
  const t = await createTestDatabase(name);
  const app = await buildApp({ config: t.config, db: t.db });
  await ensureInitialAdmin(t.db, 'initial-admin-pw');
  const admin = await readyClient(app, 'admin', 'initial-admin-pw');
  const created = await admin.post('/api/users', {
    username: 'worker',
    displayName: 'Worker',
    role: 'USER',
    password: 'initial-user-pw',
  });
  expect(created.statusCode).toBe(201);
  const user = await readyClient(app, 'worker', 'initial-user-pw');
  return {
    t,
    app,
    admin,
    user,
    close: async () => {
      await app.close();
      await t.drop();
    },
  };
}

/** Extracts all text of a PDF (TR-04: assertions on mandatory content). */
export async function pdfText(data: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  const doc = await getDocumentProxy(new Uint8Array(data));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { text: text.replace(/\s+/g, ' '), pages: totalPages };
}
