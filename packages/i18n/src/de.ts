/**
 * German is the reference language: every key defined here must exist in pl and en
 * (enforced at compile time via the `Messages` type and at test time, FR-I18N-04 / TR-05).
 */
export const de = {
  app: {
    name: 'SimpleInvoice Manager',
  },
  login: {
    title: 'Anmelden',
    username: 'Benutzername',
    password: 'Passwort',
    stayLoggedIn: 'Angemeldet bleiben',
    submit: 'Anmelden',
  },
  language: {
    label: 'Sprache',
    de: 'Deutsch',
    pl: 'Polski',
    en: 'English',
  },
  status: {
    serverUnreachable: 'Der Server ist nicht erreichbar. Bitte später erneut versuchen.',
  },
  pdf: {
    invoice: 'Rechnung',
    date: 'Datum',
    invoiceNumber: 'Rechnungsnummer',
    serviceDate: 'Leistungsdatum',
    paymentTerm: 'Zahlungsziel',
    days: 'Tage',
    subtotal: 'Zwischensumme',
    vat: 'MwSt.',
    total: 'Gesamt',
    filePrefix: 'RechnungsNr',
  },
} as const;
