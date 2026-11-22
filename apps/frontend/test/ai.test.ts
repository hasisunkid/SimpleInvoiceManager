import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { mockFetch } from './helpers';

/** M9 in the app: "Von KI erstellt" badges, filters, "Geprüft" and AI access keys. */
const customer = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  type: 'BUSINESS',
  companyName: 'Omicronservice GmbH',
  contactPerson: '',
  displayName: 'Omicronservice GmbH',
  street: '',
  zip: '',
  city: 'Beispielstadt',
  countryCode: 'DE',
  email: '',
  phone: '',
  vatId: '',
  invoiceLanguage: 'de',
  notes: '',
  archived: false,
  aiCreated: true,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
  ...overrides,
});

const token = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  userId: 1,
  userName: 'Anna Góralewicz',
  name: 'Claude on laptop',
  prefix: 'sim_AbCdEf',
  scopes: ['mcp:drafts'],
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-11-22T10:00:00.000Z',
  active: true,
  ...overrides,
});

async function plugins() {
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  return [createAppI18n('de'), createAppRouter()];
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('"Von KI erstellt" (FR-MCP-10)', () => {
  it('shows the badge in the customer list and filters by it', async () => {
    const fetch = mockFetch({});
    fetch.mockImplementation(
      async () => new Response(JSON.stringify({ items: [customer()], total: 1 })),
    );
    const CustomersView = (await import('../src/views/CustomersView.vue')).default;
    const wrapper = mount(CustomersView, { global: { plugins: await plugins() } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Von KI erstellt'));

    const filter = wrapper.findAll('label.checkbox').find((l) => l.text().includes('KI'))!;
    await filter.find('input').setValue(true);
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('aiCreated=true'))).toBe(true),
    );
  });

  it('a person confirms an AI-created customer with "Geprüft"', async () => {
    const fetch = mockFetch({
      'GET api/customers/3': () => ({ body: customer() }),
      'GET invoices?customerId=3&limit=200': () => ({
        body: { items: [], total: 0, openTotalCents: 0 },
      }),
      'POST api/customers/3/reviewed': () => ({ body: customer({ aiCreated: false }) }),
    });
    const CustomerFormView = (await import('../src/views/CustomerFormView.vue')).default;
    const wrapper = mount(CustomerFormView, {
      props: { id: 3 },
      global: { plugins: await plugins() },
    });
    await flushPromises();
    const notice = wrapper.get('[data-testid="ai-notice"]');
    expect(notice.text()).toContain('KI-Assistenten');
    await notice.get('button').trigger('click');
    await flushPromises();
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url === 'api/customers/3/reviewed' && init?.method === 'POST',
      ),
    ).toBe(true);
    expect(wrapper.find('[data-testid="ai-notice"]').exists()).toBe(false);
  });

  it('marks AI drafts in the invoice list', async () => {
    const InvoiceList = (await import('../src/components/InvoiceList.vue')).default;
    const item = {
      id: 57,
      number: null,
      status: 'DRAFT' as const,
      customerId: 3,
      customerName: 'Omicronservice GmbH',
      invoiceDate: '2026-11-22',
      dueDate: '2026-12-22',
      grossCents: 93_296,
      overdue: false,
    };
    const wrapper = mount(InvoiceList, {
      props: {
        items: [
          { ...item, aiCreated: true },
          { ...item, id: 58, aiCreated: false },
        ],
      },
      global: { plugins: await plugins() },
    });
    expect(wrapper.findAll('.badge--ai')).toHaveLength(1);
  });
});

describe('AI access keys in Profil (FR-MCP-03)', () => {
  it('creates a key, shows it once and lists only its prefix', async () => {
    let items = [
      token({ id: 1, name: 'Old', revokedAt: '2026-11-21T10:00:00.000Z', active: false }),
    ];
    const fetch = mockFetch({
      'GET api/me/tokens': () => ({ body: { mcpEnabled: true, items } }),
      'POST api/me/tokens': (init) => {
        const body = JSON.parse(String(init.body));
        items = [token({ name: body.name }), ...items];
        return { status: 201, body: { token: 'sim_secret-value', item: items[0] } };
      },
    });
    const TokenManager = (await import('../src/components/TokenManager.vue')).default;
    const wrapper = mount(TokenManager, { global: { plugins: await plugins() } });
    await flushPromises();
    expect(wrapper.text()).toContain('Widerrufen');

    await wrapper.get('#token-name').setValue('Claude on laptop');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const post = fetch.mock.calls.find(
      ([url, init]) => url === 'api/me/tokens' && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      name: 'Claude on laptop',
      expiresInDays: null,
    });
    expect(wrapper.get('[data-testid="token-secret"]').text()).toBe('sim_secret-value');
    expect(wrapper.text()).toContain('sim_AbCdEf…');
    expect(wrapper.text()).toContain('nur dieses eine Mal');
  });

  it('asks before revoking and says when MCP is switched off', async () => {
    const fetch = mockFetch({
      'GET api/me/tokens': () => ({ body: { mcpEnabled: false, items: [token()] } }),
      'DELETE api/me/tokens/9': () => ({ status: 204 }),
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const TokenManager = (await import('../src/components/TokenManager.vue')).default;
    const wrapper = mount(TokenManager, { global: { plugins: await plugins() } });
    await flushPromises();
    expect(wrapper.text()).toContain('ausgeschaltet');

    const revoke = () =>
      wrapper
        .findAll('button')
        .find((b) => b.text() === 'Widerrufen')!
        .trigger('click');
    await revoke();
    await flushPromises();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await revoke();
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url === 'api/me/tokens/9' && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('lets admins see the keys of all users', async () => {
    mockFetch({
      'GET api/admin/tokens': () => ({ body: { mcpEnabled: true, items: [token()] } }),
    });
    const TokenManager = (await import('../src/components/TokenManager.vue')).default;
    const wrapper = mount(TokenManager, {
      props: { admin: true },
      global: { plugins: await plugins() },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Benutzer: Anna Góralewicz');
    expect(wrapper.find('form').exists()).toBe(false);
  });
});
