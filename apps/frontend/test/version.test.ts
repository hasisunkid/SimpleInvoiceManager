import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { healthOk, mockFetch, noSession, user } from './helpers';

/** AR-26 / TR-22: the running version is shown on the login screen and on *Mehr*. */
async function mountAt(path: string) {
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  const App = (await import('../src/App.vue')).default;
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [createAppI18n('de'), router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const loggedIn = () => ({ body: { user: user(), csrfToken: 'csrf' } });
const devHealth = () => ({
  body: { ...healthOk().body, version: 'dev', releaseNotesUrl: null },
});

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('version label (AR-26, TR-22)', () => {
  it('shows the version on the login screen, linked to the release notes', async () => {
    mockFetch({ 'GET api/health': healthOk, 'GET api/auth/session': noSession });
    const wrapper = await mountAt('/login');
    const label = wrapper.get('[data-testid="app-version"]');
    expect(label.text()).toBe('Version 0.8.0');
    expect(label.attributes('href')).toBe(
      'https://github.com/hasisunkid/SimpleInvoiceManager/releases/tag/v0.8.0',
    );
    expect(label.attributes('rel')).toContain('noopener');
  });

  it('shows the version on the Mehr page', async () => {
    mockFetch({ 'GET api/health': healthOk, 'GET api/auth/session': loggedIn });
    const wrapper = await mountAt('/more');
    expect(wrapper.get('[data-testid="app-version"]').text()).toBe('Version 0.8.0');
  });

  it('shows local builds as "dev" without a link', async () => {
    mockFetch({ 'GET api/health': devHealth, 'GET api/auth/session': noSession });
    const wrapper = await mountAt('/login');
    const label = wrapper.get('[data-testid="app-version"]');
    expect(label.text()).toBe('Version dev');
    expect(label.element.tagName).toBe('SPAN');
  });

  it('hides the version while the server is unreachable', async () => {
    mockFetch({ 'GET api/auth/session': noSession });
    const wrapper = await mountAt('/login');
    expect(wrapper.find('[data-testid="app-version"]').exists()).toBe(false);
  });
});
