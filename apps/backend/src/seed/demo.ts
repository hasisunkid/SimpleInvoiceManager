import type { CatalogItemData, CustomerData } from '@sim/domain';
import type { Db } from '../db.js';
import { insertCatalogItem } from '../catalog/repository.js';
import { insertCustomer } from '../customers/repository.js';

/**
 * AR-17: demo data for local testing (SEED_DEMO=true). Only fills an installation that has no
 * customers and no catalogue items yet, so it never touches real data; the company profile and
 * the number range are only filled when they are still empty / unconfigured.
 */
export async function seedDemoData(db: Db): Promise<boolean> {
  const count = async (table: string) =>
    Number((await db(table).count<{ n: number | string }[]>({ n: '*' }).first())?.n ?? 0);
  if ((await count('customer')) > 0 || (await count('catalog_item')) > 0) return false;

  const company = await db('company_profile').where({ id: 1 }).first<{ name: string }>();
  if (company && !company.name) {
    await db('company_profile').where({ id: 1 }).update({
      name: 'Bau & Renovierung Góralewicz',
      owner_name: 'Jan Góralewicz',
      street: 'Hauptstraße 1',
      zip: '12345',
      city: 'Musterstadt',
      mobile: '0170 1234567',
      email: 'info@example.com',
      tax_number: '12/345/67890',
      bank_name: 'Sparkasse Musterstadt',
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
    });
  }
  await db('number_sequence')
    .where({ id: 1, configured: false })
    .update({ next_value: 104, configured: true });

  const base: Omit<CustomerData, 'type' | 'companyName' | 'contactPerson'> = {
    street: '',
    zip: '',
    city: '',
    countryCode: 'DE',
    email: '',
    phone: '',
    vatId: '',
    invoiceLanguage: 'de',
    notes: '',
  };
  const customers: CustomerData[] = [
    {
      ...base,
      type: 'PRIVATE',
      companyName: '',
      contactPerson: 'Anna Illing',
      street: 'Gartenweg 7',
      zip: '12345',
      city: 'Musterstadt',
    },
    {
      ...base,
      type: 'BUSINESS',
      companyName: 'Omicronservice GmbH',
      contactPerson: 'Herr Karaca',
      street: 'Industriestraße 5',
      zip: '54321',
      city: 'Beispielstadt',
      vatId: 'DE123456789',
    },
    {
      ...base,
      type: 'PRIVATE',
      companyName: '',
      contactPerson: 'Piotr Nowak',
      street: 'Lindenallee 3',
      zip: '12347',
      city: 'Musterstadt',
      invoiceLanguage: 'pl',
    },
  ];
  for (const customer of customers) await insertCustomer(db, customer, null);

  const catalog: CatalogItemData[] = [
    {
      type: 'WORK',
      title: 'Stundenlohn Geselle',
      description: 'Arbeitszeit Geselle',
      unitCode: 'HUR',
      unitPriceCents: 4800,
      vatRate: 19,
      active: true,
    },
    {
      type: 'WORK',
      title: 'Gartenabfälle entsorgen',
      description: 'Abholung und Entsorgung von Gartenabfällen',
      unitCode: 'LS',
      unitPriceCents: 8000,
      vatRate: 19,
      active: true,
    },
    {
      type: 'WORK',
      title: 'Innenputz',
      description: 'Kalkzementputz innen, zweilagig, inkl. Eckschutzschienen',
      unitCode: 'MTK',
      unitPriceCents: 3250,
      vatRate: 19,
      active: true,
    },
    {
      type: 'MATERIAL',
      title: 'Gipskartonplatte 12,5 mm',
      description: 'Gipskarton-Bauplatte 1250 × 2000 mm',
      unitCode: 'H87',
      unitPriceCents: 950,
      vatRate: 19,
      active: true,
    },
    {
      type: 'MATERIAL',
      title: 'Material pauschal',
      description: '',
      unitCode: 'LS',
      unitPriceCents: 0,
      vatRate: 19,
      active: true,
    },
  ];
  for (const item of catalog) await insertCatalogItem(db, item, null);
  return true;
}
