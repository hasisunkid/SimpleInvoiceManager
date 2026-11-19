import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { mockFetch } from './helpers';

const profile = {
  name: 'Bau Góralewicz',
  ownerName: 'Jan Góralewicz',
  street: 'Hauptstraße 1',
  zip: '12345',
  city: 'Musterstadt',
  countryCode: 'DE',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  taxNumber: '',
  vatId: '',
  bankName: '',
  iban: 'DE89370400440532013000',
  bic: '',
  accountHolder: '',
  taxMode: 'REGULAR',
  defaultPaymentTermDays: 30,
  defaultVatRate: 19,
  signatureName: '',
  introTexts: { de: '', pl: '', en: '' },
  closingTexts: { de: 'Danke', pl: 'Dziękujemy', en: 'Thanks' },
};

async function mountCompany(handlers: Parameters<typeof mockFetch>[0]) {
  const fetch = mockFetch(handlers);
  const { createAppI18n } = await import('../src/i18n');
  const CompanyView = (await import('../src/views/CompanyView.vue')).default;
  const wrapper = mount(CompanyView, { global: { plugins: [createAppI18n('de')] } });
  await flushPromises();
  return { wrapper, fetch };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('CompanyView (FR-COMP-01..04)', () => {
  it('lists what is missing before invoices can be created', async () => {
    const { wrapper } = await mountCompany({
      'GET api/company': () => ({
        body: { profile, readiness: { missing: ['taxId', 'numbering'] } },
      }),
    });
    const text = wrapper.text();
    expect(text).toContain('Steuernummer oder USt-IdNr.');
    expect(text).toContain('Startnummer für Rechnungen');
  });

  it('shows the IBAN in groups and validates it when leaving the field', async () => {
    const { wrapper } = await mountCompany({
      'GET api/company': () => ({ body: { profile, readiness: { missing: [] } } }),
    });
    const iban = wrapper.find('#c-iban');
    expect((iban.element as HTMLInputElement).value).toBe('DE89 3704 0044 0532 0130 00');
    await iban.setValue('DE89 3704 0044 0532 0130 01');
    await iban.trigger('blur');
    expect(wrapper.find('#c-iban-error').text()).toContain('IBAN ist ungültig');
    expect(iban.attributes('aria-describedby')).toContain('c-iban-error');
  });

  it('does not send an invalid form', async () => {
    const { wrapper, fetch } = await mountCompany({
      'GET api/company': () => ({ body: { profile, readiness: { missing: [] } } }),
    });
    await wrapper.find('#c-bic').setValue('XX');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(wrapper.find('#c-bic-error').exists()).toBe(true);
  });

  it('shows field errors reported by the server', async () => {
    const { wrapper } = await mountCompany({
      'GET api/company': () => ({ body: { profile, readiness: { missing: [] } } }),
      'PUT api/company': () => ({
        status: 400,
        body: { error: 'INVALID_TAX_NUMBER', fields: { taxNumber: 'INVALID_TAX_NUMBER' } },
      }),
    });
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('#c-taxnumber-error').text()).toContain('Steuernummer ist ungültig');
  });

  it('edits the default texts per document language (FR-COMP-03)', async () => {
    const { wrapper, fetch } = await mountCompany({
      'GET api/company': () => ({ body: { profile, readiness: { missing: [] } } }),
      'PUT api/company': (init) => ({
        body: { profile: JSON.parse(init.body as string), readiness: { missing: [] } },
      }),
    });
    const polish = wrapper.findAll('.segmented button').find((b) => b.text() === 'Polski')!;
    await polish.trigger('click');
    await wrapper.find('#c-closing-pl').setValue('Dziękujemy za zlecenie');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    const sent = JSON.parse((put[1] as RequestInit).body as string);
    expect(sent.closingTexts).toEqual({ de: 'Danke', pl: 'Dziękujemy za zlecenie', en: 'Thanks' });
    expect(wrapper.text()).toContain('Firmendaten gespeichert.');
  });
});

describe('NumberingView (FR-NUM-01)', () => {
  it('shows a live example of the next number', async () => {
    mockFetch({
      'GET api/settings/numbering': () => ({
        body: {
          prefix: '',
          minDigits: 0,
          nextValue: 104,
          resetYearly: false,
          configured: false,
          lastAssigned: null,
          nextNumber: '104',
        },
      }),
    });
    const { createAppI18n } = await import('../src/i18n');
    const { createAppRouter } = await import('../src/router');
    const NumberingView = (await import('../src/views/NumberingView.vue')).default;
    const wrapper = mount(NumberingView, {
      global: { plugins: [createAppI18n('de'), createAppRouter()] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Bitte legen Sie die Startnummer fest');
    expect(wrapper.find('.example__value').text()).toBe('104');
    await wrapper.find('#n-prefix').setValue('RE-{YYYY}-');
    await wrapper.find('#n-digits').setValue(4);
    expect(wrapper.find('.example__value').text()).toBe(`RE-${new Date().getFullYear()}-0104`);
  });
});
