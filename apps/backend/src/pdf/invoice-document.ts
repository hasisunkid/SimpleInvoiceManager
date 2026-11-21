import type { Knex } from 'knex';
import {
  calculateInvoice,
  dueDate,
  type BuyerSnapshot,
  type InvoiceDraftData,
  type SellerSnapshot,
  type TaxMode,
} from '@sim/domain';
import type { Db } from '../db.js';
import type { FileStore } from '../files/store.js';
import { loadStyle } from '../style/repository.js';
import type { InvoiceDocument } from './types.js';

export type PrintStyle = InvoiceDocument['style'];

/** Invoice style with the logo file loaded, ready for the renderer. */
export async function loadPrintStyle(
  db: Db | Knex.Transaction,
  files: FileStore,
): Promise<PrintStyle> {
  const style = await loadStyle(db as Db);
  let logo: PrintStyle['logo'] = null;
  if (style.logoFileId !== null) {
    const row = await files.find(style.logoFileId, 'LOGO');
    if (row) logo = { data: await files.read(row), mimeType: row.mime_type };
  }
  return { accentColor: style.accentColor, logoPosition: style.logoPosition, logo };
}

const NO_BUYER: BuyerSnapshot = {
  type: 'BUSINESS',
  name: '',
  attention: '',
  street: '',
  zip: '',
  city: '',
  countryCode: '',
  vatId: '',
};

/**
 * Builds the renderer input for an invoice: amounts come from the shared domain calculation
 * (AR-05), seller and buyer from the given snapshots (live data for previews, frozen data on
 * finalize – FR-COMP-05).
 */
export function buildInvoiceDocument(args: {
  invoice: InvoiceDraftData & { number: string | null };
  seller: SellerSnapshot;
  buyer: BuyerSnapshot | null;
  taxMode: TaxMode;
  style: PrintStyle;
  watermark: string | null;
}): InvoiceDocument {
  const { invoice, seller, taxMode, style, watermark } = args;
  const buyer = args.buyer ?? NO_BUYER;
  const { positions, totals } = calculateInvoice(invoice.positions, taxMode);
  return {
    language: invoice.documentLanguage,
    watermark,
    style,
    seller,
    buyer,
    number: invoice.number,
    invoiceDate: invoice.invoiceDate,
    serviceDateFrom: invoice.serviceDateFrom,
    serviceDateTo: invoice.serviceDateTo,
    paymentTermDays: invoice.paymentTermDays,
    dueDate: dueDate(invoice.invoiceDate, invoice.paymentTermDays),
    siteAddress: invoice.siteAddress,
    subject: invoice.subject,
    introText: invoice.introText,
    closingText: invoice.closingText,
    taxMode,
    positions: positions.map((p, index) => ({
      position: index + 1,
      type: p.type,
      description: p.description,
      quantityMilli: p.quantityMilli,
      unitCode: p.unitCode,
      unitPriceCents: p.unitPriceCents,
      vatRate: p.vatRate,
      lineTotalCents: p.lineTotalCents,
    })),
    totals: {
      netCents: totals.netCents,
      vatGroups: totals.vatGroups,
      grossCents: totals.grossCents,
      sections: totals.sections,
      labourCostInclVatCents: totals.labourCostInclVatCents,
    },
  };
}
