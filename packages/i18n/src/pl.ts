import type { Messages } from './types.js';

export const pl: Messages = {
  app: {
    name: 'SimpleInvoice Manager',
  },
  login: {
    title: 'Logowanie',
    username: 'Nazwa użytkownika',
    password: 'Hasło',
    stayLoggedIn: 'Nie wylogowuj mnie',
    submit: 'Zaloguj się',
  },
  language: {
    label: 'Język',
    de: 'Deutsch',
    pl: 'Polski',
    en: 'English',
  },
  status: {
    serverUnreachable: 'Serwer jest niedostępny. Spróbuj ponownie później.',
  },
  pdf: {
    invoice: 'Faktura',
    date: 'Data',
    invoiceNumber: 'Numer faktury',
    serviceDate: 'Data wykonania usługi',
    paymentTerm: 'Termin płatności',
    days: 'dni',
    subtotal: 'Suma częściowa',
    vat: 'VAT',
    total: 'Razem',
    filePrefix: 'Faktura',
  },
};
