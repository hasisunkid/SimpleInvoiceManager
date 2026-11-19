import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { healthOk, mockFetch, noSession, user } from './helpers';

/** Fresh modules per test: the session store is module state. */
async function mountLogin(locale: 'de' | 'pl' | 'en' = 'de') {
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  const App = (await import('../src/App.vue')).default;
  const i18n = createAppI18n(locale);
  const router = createAppRouter();
  await router.push('/login');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [i18n, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, i18n };
}

async function submit(wrapper: Awaited<ReturnType<typeof mountLogin>>['wrapper']) {
  await wrapper.find('#username').setValue('anna');
  await wrapper.find('#password').setValue('secret-password');
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

beforeEach(() => {
  vi.resetModules();
  // Node ≥ 25 shadows jsdom's localStorage with its own (undefined without a storage file);
  // the app tolerates missing storage, so tests only need to reset it when present.
  globalThis.localStorage?.clear?.();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('LoginView', () => {
  it('renders translated labels (FR-I18N-01)', async () => {
    mockFetch({ 'GET api/health': healthOk, 'GET api/auth/session': noSession });
    const { wrapper } = await mountLogin('pl');
    expect(wrapper.text()).toContain('Logowanie');
    expect(wrapper.text()).toContain('Hasło');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('uses only relative API URLs (AR-13)', async () => {
    const fetch = mockFetch({ 'GET api/health': healthOk, 'GET api/auth/session': noSession });
    await mountLogin();
    for (const [url] of fetch.mock.calls) expect(url).toMatch(/^api\//);
  });

  it('shows a plain-language message when the server is unreachable (NFR-UX-03)', async () => {
    mockFetch({ 'GET api/auth/session': noSession });
    const { wrapper } = await mountLogin();
    expect(wrapper.find('[role="alert"]').text()).toContain('nicht erreichbar');
  });

  it('translates a wrong password', async () => {
    mockFetch({
      'GET api/health': healthOk,
      'GET api/auth/session': noSession,
      'POST api/auth/login': () => ({ status: 401, body: { error: 'INVALID_CREDENTIALS' } }),
    });
    const { wrapper } = await mountLogin('en');
    await submit(wrapper);
    expect(wrapper.find('[role="alert"]').text()).toBe('Username or password is wrong.');
  });

  it('tells how long to wait when locked (FR-AUTH-06)', async () => {
    mockFetch({
      'GET api/health': healthOk,
      'GET api/auth/session': noSession,
      'POST api/auth/login': () => ({
        status: 429,
        body: { error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 42 },
      }),
    });
    const { wrapper } = await mountLogin('de');
    await submit(wrapper);
    expect(wrapper.find('[role="alert"]').text()).toContain('42 Sekunden');
  });

  it('logs in, sends a CSRF header and applies the saved user language', async () => {
    const fetch = mockFetch({
      'GET api/health': healthOk,
      'GET api/auth/session': noSession,
      'POST api/auth/login': () => ({
        body: { user: user({ uiLanguage: 'pl' }), csrfToken: 'csrf-1' },
      }),
    });
    const { wrapper, router, i18n } = await mountLogin('de');
    await submit(wrapper);

    const loginCall = fetch.mock.calls.find(([url]) => url === 'api/auth/login')!;
    const init = loginCall[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      username: 'anna',
      password: 'secret-password',
      stayLoggedIn: true,
    });
    // The home view is lazy-loaded, so navigation finishes asynchronously.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'));
    expect(i18n.global.locale.value).toBe('pl');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Cześć, Anna Góralewicz!'));
  });

  it('labels every input (NFR-UX-04)', async () => {
    mockFetch({ 'GET api/health': healthOk, 'GET api/auth/session': noSession });
    const { wrapper } = await mountLogin('en');
    for (const input of wrapper.findAll('input, select')) {
      const id = input.attributes('id');
      const wrapped = input.element.closest('label');
      expect(id ? wrapper.find(`label[for="${id}"]`).exists() : wrapped !== null).toBe(true);
    }
  });
});
