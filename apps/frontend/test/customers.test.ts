import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { mockFetch } from './helpers';

const anna = {
  id: 1,
  type: 'PRIVATE',
  companyName: '',
  contactPerson: 'Anna Illing',
  displayName: 'Anna Illing',
  street: 'Gartenweg 7',
  zip: '12345',
  city: 'Musterstadt',
  countryCode: 'DE',
  email: '',
  phone: '',
  vatId: '',
  invoiceLanguage: 'de',
  notes: '',
  archived: false,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
};

async function plugins() {
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  return [createAppI18n('de'), createAppRouter()];
}

beforeEach(() => {
  vi.resetModules();
  // NFR-UX-01: phone viewport.
  window.innerWidth = 375;
  // Debounced search: time only moves when vi.waitFor advances it (deterministic on slow CI).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CustomersView (FR-CUST-02)', () => {
  it('searches as you type with a debounced request', async () => {
    const fetch = mockFetch({});
    fetch.mockImplementation(async (url: string) => {
      const q = new URL(url, 'http://x/').searchParams.get('q') ?? '';
      const items = 'illing'.includes(q.toLowerCase()) ? [anna] : [];
      return new Response(JSON.stringify({ items, total: items.length }));
    });
    const CustomersView = (await import('../src/views/CustomersView.vue')).default;
    const wrapper = mount(CustomersView, { global: { plugins: await plugins() } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Anna Illing'));

    const input = wrapper.find('#customer-search');
    await input.setValue('i');
    await input.setValue('il');
    await input.setValue('ill');
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('q=ill&'))).toBe(true),
    );
    // Typing quickly sends one request for the final text, not one per key.
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('q=il&'))).toHaveLength(0);

    await input.setValue('zzz');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Keine Treffer.'));
  });
});

describe('CustomerPicker (FR-CUST-05, US #5)', () => {
  async function mountPicker(handlers: Parameters<typeof mockFetch>[0]) {
    const fetch = mockFetch(handlers);
    const CustomerPicker = (await import('../src/components/CustomerPicker.vue')).default;
    const wrapper = mount(CustomerPicker, {
      props: { modelValue: null },
      global: { plugins: await plugins() },
    });
    await flushPromises();
    return { wrapper, fetch };
  }

  it('selects a customer from the search results with one tap', async () => {
    const { wrapper } = await mountPicker({
      'GET api/customers?limit=20&q=': () => ({ body: { items: [anna], total: 1 } }),
    });
    await vi.waitFor(() => expect(wrapper.find('.list__button').exists()).toBe(true));
    await wrapper.find('.list__button').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([anna]);
  });

  it('quick-creates a customer with name and address only', async () => {
    const created = { ...anna, id: 7, contactPerson: 'Jan Nowak', displayName: 'Jan Nowak' };
    const { wrapper, fetch } = await mountPicker({
      'GET api/customers?limit=20&q=': () => ({ body: { items: [], total: 0 } }),
      'GET api/customers?limit=20&q=Jan%20Nowak': () => ({ body: { items: [], total: 0 } }),
      'POST api/customers': () => ({ status: 201, body: created }),
    });
    await wrapper.find('#picker-search').setValue('Jan Nowak');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Neuer Kunde')!
      .trigger('click');

    // The name typed into the search is taken over; only the short form is shown.
    expect((wrapper.find('#quick-person').element as HTMLInputElement).value).toBe('Jan Nowak');
    expect(wrapper.find('#quick-email').exists()).toBe(false);

    await wrapper.find('#quick-street').setValue('Lindenallee 3');
    await wrapper.find('#quick-zip').setValue('12347');
    await wrapper.find('#quick-city').setValue('Musterstadt');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      type: 'PRIVATE',
      contactPerson: 'Jan Nowak',
      street: 'Lindenallee 3',
      zip: '12347',
      city: 'Musterstadt',
    });
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([created]);
  });

  it('asks for a company name for business customers before sending', async () => {
    const { wrapper, fetch } = await mountPicker({
      'GET api/customers?limit=20&q=': () => ({ body: { items: [], total: 0 } }),
    });
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Neuer Kunde')!
      .trigger('click');
    await wrapper
      .findAll('.segmented button')
      .find((b) => b.text() === 'Firma')!
      .trigger('click');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#quick-company-error').text()).toBe('Bitte einen Namen eingeben.');
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('CatalogItemFormView (FR-CAT-01, AR-08)', () => {
  it('sends the price as integer cents parsed from German input', async () => {
    const fetch = mockFetch({
      'POST api/catalog': (init) => ({
        status: 201,
        body: { ...JSON.parse(init.body as string), id: 3 },
      }),
    });
    const CatalogItemFormView = (await import('../src/views/CatalogItemFormView.vue')).default;
    const wrapper = mount(CatalogItemFormView, { global: { plugins: await plugins() } });
    await flushPromises();

    await wrapper.find('#item-title').setValue('Innenputz');
    await wrapper.find('#item-unit').setValue('MTK');
    await wrapper.find('#item-price').setValue('1.032,50');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      type: 'WORK',
      title: 'Innenputz',
      unitCode: 'MTK',
      unitPriceCents: 103250,
      vatRate: 19,
      active: true,
    });
  });

  it('rejects an unreadable price', async () => {
    const fetch = mockFetch({});
    const CatalogItemFormView = (await import('../src/views/CatalogItemFormView.vue')).default;
    const wrapper = mount(CatalogItemFormView, { global: { plugins: await plugins() } });
    await wrapper.find('#item-title').setValue('Test');
    await wrapper.find('#item-price').setValue('12,345,6');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#item-price-error').text()).toContain('gültigen Preis');
    // Only the router's session lookup – nothing was sent.
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
