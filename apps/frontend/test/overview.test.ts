import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { calculateInvoice } from '@sim/domain';
import type { Invoice } from '../src/api';
import { mockFetch, user } from './helpers';

async function plugins() {
  const { createAppI18n } = await import('../src/i18n');
  const { createAppRouter } = await import('../src/router');
  return { i18n: createAppI18n('de'), router: createAppRouter() };
}

const page = { items: [], total: 0, openTotalCents: 0 };

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dashboard (FR-INV-20)', () => {
  it('shows counters with sums and links each tile to the filtered list', async () => {
    mockFetch({
      'GET api/invoices/summary': () => ({
        body: {
          drafts: 2,
          open: { count: 3, grossCents: 285_005 },
          overdue: { count: 1, grossCents: 9520 },
          paidThisYear: { count: 7, grossCents: 1_200_000 },
        },
      }),
      'GET api/invoices?status=DRAFT&limit=5': () => ({ body: page }),
    });
    const { i18n, router } = await plugins();
    const HomeView = (await import('../src/views/HomeView.vue')).default;
    const wrapper = mount(HomeView, { global: { plugins: [i18n, router] } });
    await flushPromises();

    const tile = (status: string) => wrapper.find(`[data-testid="tile-${status}"]`);
    expect(tile('OPEN').text()).toContain('Offen');
    expect(tile('OPEN').text()).toContain('3');
    expect(tile('OPEN').text()).toContain('2.850,05 €');
    expect(tile('OVERDUE').classes()).toContain('tile--danger');
    expect(tile('PAID').text()).toContain(`Bezahlt ${new Date().getFullYear()}`);
    expect(tile('OVERDUE').attributes('href')).toBe('#/invoices?status=OVERDUE');
  });
});

describe('invoice list filters (FR-INV-21)', () => {
  it('sends status, search, date range and sort to the API and keeps them in the URL', async () => {
    const fetch = mockFetch({});
    fetch.mockImplementation(async (url: string) =>
      url === 'api/auth/session'
        ? new Response(JSON.stringify({ user: user(), csrfToken: 'x' }))
        : new Response(JSON.stringify(page)),
    );
    const { i18n, router } = await plugins();
    await router.push({ name: 'invoices', query: { status: 'OVERDUE' } });
    const InvoicesView = (await import('../src/views/InvoicesView.vue')).default;
    const wrapper = mount(InvoicesView, { global: { plugins: [i18n, router] } });
    await flushPromises();

    const lastQuery = () => new URL(String(fetch.mock.calls.at(-1)![0]), 'http://x/').searchParams;
    expect(lastQuery().get('status')).toBe('OVERDUE');

    await wrapper.find('#invoice-search').setValue('Karaca');
    await wrapper.find('#invoice-from').setValue('2024-01-01');
    await wrapper.find('#invoice-sort').setValue('amount:desc');
    await vi.waitFor(() => expect(lastQuery().get('q')).toBe('Karaca'));
    expect(Object.fromEntries(lastQuery())).toMatchObject({
      status: 'OVERDUE',
      q: 'Karaca',
      from: '2024-01-01',
      sort: 'amount',
      order: 'desc',
    });
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toMatchObject({
        status: 'OVERDUE',
        q: 'Karaca',
        sort: 'amount:desc',
      }),
    );

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Filter zurücksetzen')!
      .trigger('click');
    await vi.waitFor(() => expect(lastQuery().get('status')).toBeNull());
  });
});

describe('status actions (FR-INV-13, FR-INV-14)', () => {
  function finalized(overrides: Record<string, unknown> = {}): Invoice {
    return {
      id: 1,
      number: '104',
      status: 'OPEN',
      version: 2,
      customerId: 5,
      customer: null,
      documentLanguage: 'de',
      invoiceDate: '2026-11-01',
      serviceDateFrom: '2026-11-01',
      serviceDateTo: null,
      paymentTermDays: 30,
      dueDate: '2026-12-01',
      siteAddress: '',
      subject: '',
      introText: '',
      closingText: '',
      taxMode: 'REGULAR',
      positions: [],
      totals: calculateInvoice([], 'REGULAR').totals,
      finalizeProblems: [],
      overdue: false,
      paidAt: null,
      cancelReason: null,
      createdAt: '',
      updatedAt: '',
      ...overrides,
    } as Invoice;
  }

  async function mountActions(
    invoice: ReturnType<typeof finalized>,
    handlers: Parameters<typeof mockFetch>[0],
  ) {
    const fetch = mockFetch({ 'GET api/invoices/1/history': () => ({ body: [] }), ...handlers });
    const { i18n } = await plugins();
    const InvoiceStatusActions = (await import('../src/components/InvoiceStatusActions.vue'))
      .default;
    const wrapper = mount(InvoiceStatusActions, {
      props: { invoice, version: invoice.version },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    return { wrapper, fetch };
  }

  it('marks an open invoice as paid with the chosen date', async () => {
    const { wrapper, fetch } = await mountActions(finalized(), {
      'POST api/invoices/1/pay': (init) => ({
        body: finalized({
          status: 'PAID',
          paidAt: JSON.parse(init.body as string).paidAt,
          version: 3,
        }),
      }),
    });
    await wrapper.find('#paid-at').setValue('2026-11-15');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/pay'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      version: 2,
      paidAt: '2026-11-15',
    });
    expect(wrapper.emitted('changed')?.[0]?.[0]).toMatchObject({ status: 'PAID' });
  });

  it('requires a reason and a confirmation before cancelling', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { wrapper, fetch } = await mountActions(finalized(), {
      'POST api/invoices/1/cancel': () => ({
        body: finalized({ status: 'CANCELLED', cancelReason: 'Doppelt' }),
      }),
    });
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Rechnung stornieren')!
      .trigger('click');
    const cancelForm = wrapper.findAll('form').at(-1)!;
    await cancelForm.trigger('submit');
    expect(wrapper.text()).toContain('Bitte einen Grund für die Stornierung angeben.');
    expect(confirm).not.toHaveBeenCalled();

    await wrapper.find('#cancel-reason').setValue('Doppelt');
    await cancelForm.trigger('submit');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('104'));
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/cancel'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      version: 2,
      reason: 'Doppelt',
    });
  });

  it('offers only the actions of the current status', async () => {
    const paid = await mountActions(finalized({ status: 'PAID', paidAt: '2026-11-15' }), {});
    const labels = paid.wrapper.findAll('button').map((b) => b.text());
    expect(labels).toContain('Zahlung zurücknehmen');
    expect(labels).not.toContain('Rechnung stornieren');
    expect(paid.wrapper.text()).toContain('Bezahlt am 15.11.2026');

    const cancelled = await mountActions(
      finalized({ status: 'CANCELLED', cancelReason: 'Falscher Betrag' }),
      {},
    );
    expect(cancelled.wrapper.text()).toContain('Storniert: Falscher Betrag');
    expect(cancelled.wrapper.findAll('button').map((b) => b.text())).toEqual([
      'Korrigierte Kopie erstellen',
    ]);
  });
});
