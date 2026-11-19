import type { Messages } from './types.js';

export const en: Messages = {
  app: {
    name: 'SimpleInvoice Manager',
  },
  login: {
    title: 'Sign in',
    username: 'Username',
    password: 'Password',
    stayLoggedIn: 'Stay signed in',
    submit: 'Sign in',
  },
  language: {
    label: 'Language',
    de: 'Deutsch',
    pl: 'Polski',
    en: 'English',
  },
  status: {
    serverUnreachable: 'The server cannot be reached. Please try again later.',
  },
  pdf: {
    invoice: 'Invoice',
    date: 'Date',
    invoiceNumber: 'Invoice number',
    serviceDate: 'Service date',
    paymentTerm: 'Payment term',
    days: 'days',
    subtotal: 'Subtotal',
    vat: 'VAT',
    total: 'Total',
    filePrefix: 'Invoice',
  },
};
