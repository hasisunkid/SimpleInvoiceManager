import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { calculateInvoice } from '@sim/domain';
import { mockFetch } from './helpers';

const texts = (de: string, pl: string, en: string) => ({ de, pl, en });
const company = {
  profile: {
    name: 'Bau Góralewicz',
    taxMode: 'REGULAR',
    defaultVatRate: 19,
    introTexts: texts('', '', ''),
    closingTexts: texts('Vielen Dank!', 'Dziękujemy!', 'Thank you!'),
  },
};
const nowak = {
  id: 5,
  type: 'PRIVATE',
  companyName: '',
  contactPerson: 'Piotr Nowak',
  displayName: 'Piotr Nowak',
  street: 'Lindenallee 3',
  zip: '12347',
  city: 'Musterstadt',
  countryCode: 'DE',
  email: '',
  phone: '',
  vatId: '',
  invoiceLanguage: 'pl',
  notes: '',
  archived: false,
  createdAt: '',
  updatedAt: '',
};
const gardenWaste = {
  id: 2,
  type: 'WORK',
  title: 'Gartenabfälle entsorgen',
  description: 'Abholung und Entsorgung',
  unitCode: 'LS',
  unitPriceCents: 8000,
  vatRate: 19,
  active: true,
  createdAt: '',
  updatedAt: '',
};

function invoice(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 1,
    number: null,
    status: 'DRAFT',
    version: 1,
    customerId: null,
    customer: null,
    documentLanguage: 'de',
    invoiceDate: '2026-11-21',
    serviceDateFrom: '2026-11-21',
    serviceDateTo: null,
    paymentTermDays: 30,
    dueDate: '2026-12-21',
    siteAddress: '',
    subject: '',
    introText: '',
    closingText: 'Vielen Dank!',
    taxMode: 'REGULAR',
    positions: [],
    finalizeProblems: ['CUSTOMER_MISSING', 'NO_POSITIONS'],
    overdue: false,
    paidAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
  return { ...base, totals: calculateInvoice(base.positions as never[], 'REGULAR').totals };
}

/** Handles PUTs like the server: bumps the version and echoes the content. */
function putHandler(state: { version: number }) {
  return (init: RequestInit) => {
    const sent = JSON.parse(init.body as string);
    state.version += 1;
    return { body: invoice({ ...sent, version: state.version, finalizeProblems: [] }) };
  };
}

async function mountEditor(handlers: Parameters<typeof mockFetch>[0]) {
  const fetch = mockFetch({
    'GET api/company': () => ({ body: company }),
    'GET api/customers?limit=20&q=': () => ({ body: { items: [nowak], total: 1 } }),
    'GET api/catalog?q=': () => ({ body: [gardenWaste] }),
    ...handlers,
  });
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  const InvoiceEditorView = (await import('../src/views/InvoiceEditorView.vue')).default;
  const wrapper = mount(InvoiceEditorView, {
    props: { id: 1 },
    global: { plugins: [createAppI18n('de'), createAppRouter()] },
    attachTo: document.body,
  });
  await flushPromises();
  await vi.waitFor(() => expect(wrapper.find('.positions').exists()).toBe(true));
  return { wrapper, fetch };
}

const puts = (fetch: ReturnType<typeof mockFetch>) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

async function clickText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === text);
  expect(button, `button "${text}"`).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('invoice editor (FR-INV-01..06, NFR-UX-02)', () => {
  it('creates a simple invoice in three taps: customer, "From services", item', async () => {
    const state = { version: 1 };
    const { wrapper, fetch } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice() }),
      'PUT api/invoices/1': putHandler(state),
    });

    await vi.waitFor(() => expect(wrapper.find('.list__button').exists()).toBe(true));
    await wrapper.find('.list__button').trigger('click'); // tap 1: customer
    await clickText(wrapper, 'Aus Leistungen'); // tap 2
    await vi.waitFor(() => expect(wrapper.find('.sheet .list__button').exists()).toBe(true));
    await wrapper.find('.sheet .list__button').trigger('click'); // tap 3: catalogue item

    // Totals are calculated immediately with the shared domain code (102 Illing: 95,20 €).
    expect(wrapper.find('[data-testid="gross"]').text()).toBe('95,20 €');
    expect(wrapper.text()).toContain('Gartenabfälle entsorgen');

    await vi.waitFor(() => expect(puts(fetch)).toHaveLength(1), { timeout: 3000 });
    expect(puts(fetch)[0]).toMatchObject({
      version: 1,
      customerId: 5,
      // The customer's invoice language switches language and default texts (FR-I18N-02).
      documentLanguage: 'pl',
      closingText: 'Dziękujemy!',
      positions: [
        {
          type: 'WORK',
          description: 'Gartenabfälle entsorgen\nAbholung und Entsorgung',
          quantityMilli: 1000,
          unitCode: 'LS',
          unitPriceCents: 8000,
          vatRate: 19,
        },
      ],
    });
    await vi.waitFor(() => expect(wrapper.find('.save-state').text()).toBe('Gespeichert'));
  });

  it('batches quick edits into one auto-save and sends the latest version', async () => {
    const state = { version: 1 };
    const { wrapper, fetch } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice() }),
      'PUT api/invoices/1': putHandler(state),
    });
    await clickText(wrapper, 'Freie Position');
    const description = wrapper.find('textarea[id$="-description"]');
    for (const text of ['A', 'Ab', 'Abriss', 'Abriss Wand']) await description.setValue(text);
    await wrapper.find('input[id$="-price"]').setValue('250,50');

    await vi.waitFor(() => expect(puts(fetch)).toHaveLength(1), { timeout: 3000 });
    expect(puts(fetch)[0].positions[0]).toMatchObject({
      description: 'Abriss Wand',
      unitCode: 'LS',
      unitPriceCents: 25_050,
    });

    // The next save uses the version the server returned.
    await description.setValue('Abriss Wand Küche');
    await vi.waitFor(() => expect(puts(fetch)).toHaveLength(2), { timeout: 3000 });
    expect(puts(fetch)[1].version).toBe(2);
  });

  it('never saves an invalid quantity', async () => {
    const state = { version: 1 };
    const { wrapper, fetch } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice() }),
      'PUT api/invoices/1': putHandler(state),
    });
    await clickText(wrapper, 'Freie Position');
    await wrapper.find('input[id$="-quantity"]').setValue('2,5');
    await wrapper.find('input[id$="-quantity"]').setValue('0');
    expect(wrapper.text()).toContain('Bitte eine Menge größer als 0 eingeben');
    await vi.waitFor(() => expect(puts(fetch).length).toBeGreaterThan(0), { timeout: 3000 });
    expect(puts(fetch).at(-1).positions[0].quantityMilli).toBe(2500);
  });

  it('reports a conflict when another device changed the invoice', async () => {
    const { wrapper } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice() }),
      'PUT api/invoices/1': () => ({ status: 409, body: { error: 'INVOICE_CHANGED' } }),
    });
    await clickText(wrapper, 'Freie Position');
    await vi.waitFor(() => expect(wrapper.text()).toContain('auf einem anderen Gerät geändert'), {
      timeout: 3000,
    });
    expect(wrapper.findAll('button').some((b) => b.text() === 'Neu laden')).toBe(true);
  });

  it('shows the § 35a labour share for private customers (FR-INV-04)', async () => {
    const positions = [
      {
        type: 'WORK',
        description: 'Arbeit',
        quantityMilli: 1000,
        unitCode: 'LS',
        unitPriceCents: 175_500,
        vatRate: 19,
      },
      {
        type: 'MATERIAL',
        description: 'Material',
        quantityMilli: 1000,
        unitCode: 'LS',
        unitPriceCents: 64_000,
        vatRate: 19,
      },
    ];
    const { wrapper } = await mountEditor({
      'GET api/invoices/1': () => ({
        body: invoice({ positions, customerId: 5, customer: nowak }),
      }),
    });
    const text = wrapper.find('.totals').text();
    expect(text).toContain('Zwischensumme Arbeit');
    expect(text).toContain('1.755,00 €');
    expect(text).toContain('MwSt. 19 %');
    expect(text).toContain('2.850,05 €');
    expect(text).toContain('Enthaltene Arbeitskosten inkl. MwSt.');
    expect(text).toContain('2.088,45 €');
  });

  it('is read-only for finalized invoices (FR-INV-13)', async () => {
    const { wrapper, fetch } = await mountEditor({
      'GET api/invoices/1': () => ({
        body: invoice({ status: 'OPEN', number: '104', customer: nowak, customerId: 5 }),
      }),
    });
    expect(wrapper.find('h1').text()).toBe('Rechnung 104');
    expect(wrapper.text()).toContain('kann nicht mehr geändert werden');
    expect(wrapper.findAll('button').some((b) => b.text() === 'Freie Position')).toBe(false);
    // Disabled through the surrounding <fieldset disabled>.
    expect(wrapper.find('#inv-subject').element.matches(':disabled')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(puts(fetch)).toHaveLength(0);
  });

  it('finalizes after confirmation and then offers the stored PDF (FR-INV-11, FR-PDF-05)', async () => {
    const ready = invoice({ customerId: 5, customer: nowak, finalizeProblems: [], version: 3 });
    const { wrapper, fetch } = await mountEditor({
      'GET api/invoices/1': () => ({ body: ready }),
      'POST api/invoices/1/finalize': () => ({
        body: invoice({ ...ready, status: 'OPEN', number: '104', version: 4 }),
      }),
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await clickText(wrapper, 'Rechnung erstellen (PDF)');
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/finalize'))).toBe(false);

    await clickText(wrapper, 'Rechnung erstellen (PDF)');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Rechnung 104 wurde erstellt.'));
    expect(confirm).toHaveBeenCalledTimes(2);
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/finalize'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ version: 3 });

    expect(wrapper.find('h1').text()).toBe('Rechnung 104');
    const open = wrapper.findAll('a').find((a) => a.text() === 'PDF öffnen')!;
    expect(open.attributes('href')).toBe('api/invoices/1/pdf');
    expect(open.attributes('target')).toBe('_blank');
    expect(wrapper.findAll('a').some((a) => a.text() === 'PDF herunterladen')).toBe(true);
    expect(wrapper.findAll('button').some((b) => b.text() === 'Rechnung erstellen (PDF)')).toBe(
      false,
    );
  });

  it('keeps "create" disabled while the § 14 checklist is not empty (FR-INV-07)', async () => {
    const { wrapper } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice() }),
    });
    const button = wrapper.findAll('button').find((b) => b.text() === 'Rechnung erstellen (PDF)')!;
    expect(button.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Mindestens eine Position hinzufügen');
  });

  it('opens the preview of the saved state in a new tab (FR-INV-12)', async () => {
    const tab = { location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { wrapper } = await mountEditor({
      'GET api/invoices/1': () => ({ body: invoice({ version: 7 }) }),
    });
    await clickText(wrapper, 'Vorschau (PDF)');
    await vi.waitFor(() => expect(tab.location.href).toBe('api/invoices/1/preview?v=7'));
  });
});
