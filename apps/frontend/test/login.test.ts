import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import LoginView from '../src/views/LoginView.vue';
import { createAppI18n } from '../src/i18n';

function mountLogin(locale: 'de' | 'pl' | 'en', healthOk: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      healthOk
        ? new Response(
            JSON.stringify({
              status: 'ok',
              database: true,
              migrations: { applied: 1, pending: 0 },
            }),
          )
        : new Response('', { status: 503 }),
    ),
  );
  return mount(LoginView, { global: { plugins: [createAppI18n(locale)] } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginView', () => {
  it('renders translated labels (FR-I18N-01)', async () => {
    const wrapper = mountLogin('pl', true);
    await flushPromises();
    expect(wrapper.text()).toContain('Logowanie');
    expect(wrapper.text()).toContain('Hasło');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('calls the health endpoint with a relative URL (AR-13)', async () => {
    mountLogin('de', true);
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith('api/health', expect.anything());
  });

  it('shows a plain-language message when the server is unreachable (NFR-UX-03)', async () => {
    const wrapper = mountLogin('de', false);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('nicht erreichbar');
  });

  it('labels every input (NFR-UX-04)', () => {
    const wrapper = mountLogin('en', true);
    for (const input of wrapper.findAll('input, select')) {
      const id = input.attributes('id');
      const wrapped = input.element.closest('label');
      expect(id ? wrapper.find(`label[for="${id}"]`).exists() : wrapped !== null).toBe(true);
    }
  });
});
