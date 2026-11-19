import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, noSession, user } from './helpers';

async function routerWith(session: () => { body: unknown }) {
  mockFetch({ 'GET api/auth/session': session });
  const { createAppRouter } = await import('../src/router');
  return createAppRouter();
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('router guards (mirror of the backend rules)', () => {
  it('sends anonymous users to login and remembers the target', async () => {
    const router = await routerWith(noSession);
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/profile');
  });

  it('forces the password change before anything else (FR-AUTH-03)', async () => {
    const router = await routerWith(() => ({
      body: { user: user({ mustChangePassword: true }), csrfToken: 'x' },
    }));
    await router.push('/users');
    expect(router.currentRoute.value.name).toBe('change-password');
  });

  it('keeps normal users out of user management (FR-AUTH-02)', async () => {
    const router = await routerWith(() => ({ body: { user: user(), csrfToken: 'x' } }));
    await router.push('/settings/users/new');
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('lets admins into user management', async () => {
    const router = await routerWith(() => ({
      body: { user: user({ role: 'ADMIN' }), csrfToken: 'x' },
    }));
    await router.push('/settings/users/7');
    expect(router.currentRoute.value.name).toBe('user-edit');
  });

  it('skips the login page when already logged in', async () => {
    const router = await routerWith(() => ({ body: { user: user(), csrfToken: 'x' } }));
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('home');
  });
});
