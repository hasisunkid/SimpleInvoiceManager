import type { IsoDate, SellerSnapshot, TaxMode, VatRate } from '@sim/domain';
import type { Language } from '@sim/i18n';
import type { LogoPosition } from '../style/repository.js';

/**
 * Everything needed to print one invoice – already calculated and frozen (FR-COMP-05).
 * Renderers only lay this out; they never compute amounts.
 */
export interface InvoiceDocument {
  readonly language: Language;
  /** Diagonal watermark, e.g. "ENTWURF / DRAFT / SZKIC" for previews (FR-INV-12). */
  readonly watermark: string | null;
  readonly style: {
    readonly accentColor: string;
    readonly logoPosition: LogoPosition;
    readonly logo: { readonly data: Buffer; readonly mimeType: string } | null;
  };
  readonly seller: SellerSnapshot;
  readonly buyer: {
    readonly name: string;
    readonly attention: string;
    readonly street: string;
    readonly zip: string;
    readonly city: string;
    /** ISO country code; printed only when it differs from the seller's country. */
    readonly countryCode: string;
  };
  /** Null for drafts and previews (numbers are assigned on finalize, FR-NUM-02). */
  readonly number: string | null;
  readonly invoiceDate: IsoDate;
  readonly serviceDateFrom: IsoDate;
  readonly serviceDateTo: IsoDate | null;
  readonly paymentTermDays: number;
  readonly dueDate: IsoDate;
  readonly siteAddress: string;
  readonly subject: string;
  readonly introText: string;
  readonly closingText: string;
  readonly taxMode: TaxMode;
  readonly positions: readonly InvoiceDocumentPosition[];
  readonly totals: {
    readonly netCents: number;
    readonly vatGroups: readonly { rate: VatRate; netCents: number; vatCents: number }[];
    readonly grossCents: number;
  };
}

export interface InvoiceDocumentPosition {
  readonly position: number;
  readonly description: string;
  /** Thousandths, e.g. 1500 = 1,5. */
  readonly quantityMilli: number;
  /** UN/ECE Rec. 20 unit code (FR-CAT-02), e.g. "HUR", "LS". */
  readonly unitCode: string;
  readonly unitPriceCents: number;
  readonly vatRate: VatRate;
  readonly lineTotalCents: number;
}

/** AR-06: rendering sits behind an interface so a ZUGFeRD renderer can be added later. */
export interface InvoiceRenderer {
  readonly mimeType: string;
  render(document: InvoiceDocument): Promise<Buffer>;
}
