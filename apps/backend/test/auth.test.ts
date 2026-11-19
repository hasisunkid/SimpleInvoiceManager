import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ensureInitialAdmin } from '../src/users/bootstrap.js';
import { findUserByUsername } from '../src/users/repository.js';
import { createTestDatabase, type TestDatabase } from './helpers/db.js';
import { TestClient } from './helpers/client.js';

const ADMIN_INITIAL = 'initial-admin-pw';
const ADMIN_PW = 'admin-password-1';

let t: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDatabase('auth');
  app = await buildApp({ config: t.config, db: t.db });
  await ensureInitialAdmin(t.db, ADMIN_INITIAL);
});

afterAll(async () => {
  await app?.close();
  await t?.drop();
});

/** Logged-in admin who already changed the initial password. */
async function adminClient(): Promise<TestClient> {
  const client = new TestClient(app);
  const res = await client.login('admin', ADMIN_PW);
  expect(res.statusCode).toBe(200);
  return client;
}

/** Creates a user via the API and returns a client logged in with a changed password. */
async function createUser(
  admin: TestClient,
  username: string,
  role: 'USER' | 'ADMIN' = 'USER',
): Promise<{ id: number; client: TestClient; password: string }> {
  const created = await admin.post('/api/users', {
    username,
    displayName: `Name ${username}`,
    role,
    password: 'first-password-1',
  });
  expect(created.statusCode).toBe(201);
  const client = new TestClient(app);
  expect((await client.login(username, 'first-password-1')).statusCode).toBe(200);
  const password = `${username}-final-pw`;
  const changed = await client.put('/api/me/password', {
    currentPassword: 'first-password-1',
    newPassword: password,
  });
  expect(changed.statusCode).toBe(200);
  return { id: created.json().id, client, password };
}

describe('bootstrap (FR-AUTH-03)', () => {
  it('created the admin with must_change_password', async () => {
    const row = await findUserByUsername(t.db, 'admin');
    expect(row).toMatchObject({ role: 'ADMIN' });
    expect(Boolean(row?.must_change_password)).toBe(true);
  });

  it('does nothing when users exist', async () => {
    expect(await ensureInitialAdmin(t.db, 'whatever-password')).toEqual({ created: false });
  });

  it('generates a random password when none is configured', async () => {
    const other = await createTestDatabase('bootstrap');
    try {
      const result = await ensureInitialAdmin(other.db, undefined);
      expect(result.created).toBe(true);
      const generated = result.created ? result.generatedPassword : undefined;
      expect(generated?.length).toBeGreaterThanOrEqual(16);
      const otherApp = await buildApp({ config: other.config, db: other.db });
      const res = await new TestClient(otherApp).login('admin', generated!);
      expect(res.statusCode).toBe(200);
      await otherApp.close();
    } finally {
      await other.drop();
    }
  });
});

describe('first login and forced password change (FR-AUTH-03)', () => {
  it('rejects a wrong password with a generic message', async () => {
    const res = await new TestClient(app).login('admin', 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('answers an unknown user exactly like a wrong password', async () => {
    const res = await new TestClient(app).login('nobody', 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
  });

  it('blocks everything except password change until the password is changed', async () => {
    const client = new TestClient(app);
    const login = await client.login('Admin', ADMIN_INITIAL); // usernames are case-insensitive
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({ username: 'admin', mustChangePassword: true });

    const users = await client.get('/api/users');
    expect(users.statusCode).toBe(403);
    expect(users.json().error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await client.get('/api/auth/session')).json().user.mustChangePassword).toBe(true);

    const wrong = await client.put('/api/me/password', {
      currentPassword: 'not-it-at-all',
      newPassword: ADMIN_PW,
    });
    expect(wrong.json().error).toBe('WRONG_CURRENT_PASSWORD');

    const same = await client.put('/api/me/password', {
      currentPassword: ADMIN_INITIAL,
      newPassword: ADMIN_INITIAL,
    });
    expect(same.json().error).toBe('PASSWORD_UNCHANGED');

    const tooShort = await client.put('/api/me/password', {
      currentPassword: ADMIN_INITIAL,
      newPassword: 'short',
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().error).toBe('VALIDATION_FAILED');

    const ok = await client.put('/api/me/password', {
      currentPassword: ADMIN_INITIAL,
      newPassword: ADMIN_PW,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mustChangePassword).toBe(false);
    expect((await client.get('/api/users')).statusCode).toBe(200);
  });
});

describe('sessions and cookies (FR-AUTH-07)', () => {
  it('sets an HttpOnly, SameSite=Strict session cookie without Max-Age by default', async () => {
    const res = await new TestClient(app).login('admin', ADMIN_PW, false);
    const cookie = res.cookies.find((c) => c.name === 'sim_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie?.maxAge).toBeUndefined();
  });

  it('keeps "stay logged in" sessions for 30 days', async () => {
    const res = await new TestClient(app).login('admin', ADMIN_PW, true);
    const cookie = res.cookies.find((c) => c.name === 'sim_session');
    expect(cookie?.maxAge).toBeGreaterThan(30 * 24 * 3600 - 60);
    expect(cookie?.maxAge).toBeLessThanOrEqual(30 * 24 * 3600);
  });

  it('scopes the cookie to the Home Assistant ingress path (AR-13)', async () => {
    const client = new TestClient(app, { 'x-ingress-path': '/api/hassio_ingress/abc123' });
    const res = await client.login('admin', ADMIN_PW);
    expect(res.cookies.find((c) => c.name === 'sim_session')?.path).toBe(
      '/api/hassio_ingress/abc123/',
    );
  });

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const client = new TestClient(app, { 'x-forwarded-proto': 'https' });
    const res = await client.login('admin', ADMIN_PW);
    expect(res.cookies.find((c) => c.name === 'sim_session')?.secure).toBe(true);
  });

  it('reports no user without a session', async () => {
    const res = await new TestClient(app).get('/api/auth/session');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null, csrfToken: null });
  });

  it('rejects requests without a session on protected routes', async () => {
    const res = await new TestClient(app).get('/api/users');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHENTICATED');
  });

  it('logout ends the session on the server', async () => {
    const client = await adminClient();
    const cookie = client.cookie;
    expect((await client.post('/api/auth/logout')).statusCode).toBe(204);
    const stale = new TestClient(app);
    stale.cookie = cookie;
    expect((await stale.get('/api/users')).statusCode).toBe(401);
  });

  it('ignores forged or malformed session cookies', async () => {
    const client = new TestClient(app);
    client.cookie = 'sim_session=' + 'A'.repeat(43);
    expect((await client.get('/api/users')).statusCode).toBe(401);
    client.cookie = 'sim_session=%00garbage';
    expect((await client.get('/api/users')).statusCode).toBe(401);
  });
});

describe('CSRF protection (FR-AUTH-07)', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const client = await adminClient();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/language',
      headers: { cookie: client.cookie! },
      payload: { uiLanguage: 'pl' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CSRF_FAILED');
  });

  it('rejects a CSRF token of another session', async () => {
    const a = await adminClient();
    const b = await adminClient();
    a.csrfToken = b.csrfToken;
    const res = await a.put('/api/me/language', { uiLanguage: 'pl' });
    expect(res.statusCode).toBe(403);
  });

  it('requires the header even for login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: ADMIN_PW },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('own profile (FR-AUTH-05)', () => {
  it('changes the UI language', async () => {
    const client = await adminClient();
    const res = await client.put('/api/me/language', { uiLanguage: 'pl' });
    expect(res.statusCode).toBe(200);
    expect(res.json().uiLanguage).toBe('pl');
    expect((await client.put('/api/me/language', { uiLanguage: 'fr' })).statusCode).toBe(400);
    expect((await client.put('/api/me/language', { uiLanguage: null })).json().uiLanguage).toBe(
      null,
    );
  });

  it('changing the password logs out other devices but keeps this one', async () => {
    const admin = await adminClient();
    const { client: phone, password } = await createUser(admin, 'jan');
    const laptop = new TestClient(app);
    await laptop.login('jan', password);

    const res = await phone.put('/api/me/password', {
      currentPassword: password,
      newPassword: 'jan-new-password',
    });
    expect(res.statusCode).toBe(200);
    expect((await phone.get('/api/auth/session')).json().user.username).toBe('jan');
    expect((await laptop.get('/api/auth/session')).json().user).toBeNull();
  });
});

describe('user management (FR-AUTH-04)', () => {
  it('lists users without password hashes', async () => {
    const admin = await adminClient();
    const res = await admin.get('/api/users');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('argon2');
    expect(res.json()[0]).not.toHaveProperty('password_hash');
  });

  it('creates users with normalized usernames; new users must change the password', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/users', {
      username: 'Ewa.K',
      displayName: '  Ewa Góralewicz  ',
      role: 'USER',
      password: 'start-password',
      uiLanguage: 'pl',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      username: 'ewa.k',
      displayName: 'Ewa Góralewicz',
      role: 'USER',
      uiLanguage: 'pl',
      active: true,
      mustChangePassword: true,
    });

    const duplicate = await admin.post('/api/users', {
      username: 'EWA.K',
      displayName: 'Other',
      role: 'USER',
      password: 'start-password',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('USERNAME_TAKEN');
  });

  it('validates input', async () => {
    const admin = await adminClient();
    for (const body of [
      { username: 'x', displayName: 'X', role: 'USER', password: 'long-enough-pw' },
      { username: 'valid', displayName: 'X', role: 'ROOT', password: 'long-enough-pw' },
      { username: 'valid', displayName: 'X', role: 'USER', password: 'short' },
      { username: 'valid', displayName: '', role: 'USER', password: 'long-enough-pw' },
    ]) {
      const res = await admin.post('/api/users', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await admin.patch('/api/users/1', {})).statusCode).toBe(400);
    expect((await admin.get('/api/users/999999')).statusCode).toBe(404);
  });

  it('a USER gets 403 on every admin endpoint (TR-02)', async () => {
    const admin = await adminClient();
    const { id, client: user } = await createUser(admin, 'plain.user');
    const calls = [
      user.get('/api/users'),
      user.get(`/api/users/${id}`),
      user.post('/api/users', {
        username: 'evil',
        displayName: 'Evil',
        role: 'ADMIN',
        password: 'evil-password',
      }),
      user.patch(`/api/users/${id}`, { role: 'ADMIN' }),
      user.put(`/api/users/${id}/password`, { newPassword: 'evil-password' }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('FORBIDDEN');
    }
  });

  it('password reset forces a change and ends all sessions of the user', async () => {
    const admin = await adminClient();
    const { id, client } = await createUser(admin, 'reset.me');
    const res = await admin.put(`/api/users/${id}/password`, { newPassword: 'reset-password-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mustChangePassword).toBe(true);
    expect((await client.get('/api/auth/session')).json().user).toBeNull();

    const again = new TestClient(app);
    expect((await again.login('reset.me', 'reset-password-1')).json().user.mustChangePassword).toBe(
      true,
    );
  });

  it('deactivation logs the user out and blocks login; reactivation restores it', async () => {
    const admin = await adminClient();
    const { id, client, password } = await createUser(admin, 'temp.worker');

    const off = await admin.patch(`/api/users/${id}`, { active: false });
    expect(off.json().active).toBe(false);
    expect((await client.get('/api/auth/session')).json().user).toBeNull();
    expect((await new TestClient(app).login('temp.worker', password)).statusCode).toBe(401);

    await admin.patch(`/api/users/${id}`, { active: true });
    expect((await new TestClient(app).login('temp.worker', password)).statusCode).toBe(200);
  });

  it('edits display name, role and language', async () => {
    const admin = await adminClient();
    const { id } = await createUser(admin, 'edit.me');
    const res = await admin.patch(`/api/users/${id}`, {
      displayName: 'Edited',
      role: 'ADMIN',
      uiLanguage: 'en',
    });
    expect(res.json()).toMatchObject({ displayName: 'Edited', role: 'ADMIN', uiLanguage: 'en' });
    await admin.patch(`/api/users/${id}`, { role: 'USER' });
  });
});

describe('last active admin (FR-AUTH-04)', () => {
  it('cannot be demoted or deactivated', async () => {
    const other = await createTestDatabase('lastadmin');
    const otherApp = await buildApp({ config: other.config, db: other.db });
    try {
      await ensureInitialAdmin(other.db, ADMIN_INITIAL);
      const admin = new TestClient(otherApp);
      await admin.login('admin', ADMIN_INITIAL);
      await admin.put('/api/me/password', {
        currentPassword: ADMIN_INITIAL,
        newPassword: ADMIN_PW,
      });
      const { id: adminId } = (await admin.get('/api/auth/session')).json().user;

      for (const change of [{ role: 'USER' }, { active: false }]) {
        const res = await admin.patch(`/api/users/${adminId}`, change);
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe('LAST_ADMIN');
      }

      // With a second active admin, the first one may step down.
      const second = await admin.post('/api/users', {
        username: 'second.admin',
        displayName: 'Second',
        role: 'ADMIN',
        password: 'second-admin-pw',
      });
      const secondId = second.json().id;
      expect((await admin.patch(`/api/users/${adminId}`, { role: 'USER' })).statusCode).toBe(200);

      // Parallel demotions of the two remaining admins: at most one may succeed (row lock).
      const superAdmin = new TestClient(otherApp);
      await superAdmin.login('second.admin', 'second-admin-pw');
      await superAdmin.put('/api/me/password', {
        currentPassword: 'second-admin-pw',
        newPassword: 'second-admin-pw2',
      });
      const third = await superAdmin.post('/api/users', {
        username: 'third.admin',
        displayName: 'Third',
        role: 'ADMIN',
        password: 'third-admin-pw',
      });
      const results = await Promise.all([
        superAdmin.patch(`/api/users/${secondId}`, { active: false }),
        superAdmin.patch(`/api/users/${third.json().id}`, { active: false }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    } finally {
      await otherApp.close();
      await other.drop();
    }
  });
});

describe('login rate limiting (FR-AUTH-06)', () => {
  it('locks the username after 5 failures, even for the right password', async () => {
    const admin = await adminClient();
    const { password } = await createUser(admin, 'locked.out');
    const client = new TestClient(app);
    for (let i = 0; i < 5; i++) {
      expect((await client.login('locked.out', 'wrong-password')).statusCode).toBe(401);
    }
    const res = await client.login('locked.out', password);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'TOO_MANY_ATTEMPTS' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(50);

    // Other users are not affected.
    expect((await new TestClient(app).login('admin', ADMIN_PW)).statusCode).toBe(200);
  });
});
