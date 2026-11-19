import {
  addDays,
  divRoundHalfUp,
  sellerSnapshot,
  type CompanyProfile,
  type VatRate,
} from '@sim/domain';
import { translate, type Language } from '@sim/i18n';
import type { InvoiceStyle } from '../style/repository.js';
import type { InvoiceDocument } from './types.js';

/**
 * Sample invoice for the style preview (FR-STYLE-03): the real company data with the
 * (possibly unsaved) style, and the two lump-sum positions of reference invoice 104 at 19 %.
 */
export function buildSampleInvoice(
  company: CompanyProfile,
  style: Omit<InvoiceStyle, 'logoFileId'> & {
    logo: InvoiceDocument['style']['logo'];
  },
  language: Language,
  today: string,
): InvoiceDocument {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const seller = sellerSnapshot(company);
  const smallBusiness = company.taxMode === 'SMALL_BUSINESS_19';
  const rate: VatRate = smallBusiness ? 0 : 19;
  const lines = [
    { description: t('pdfSample.work'), cents: 175_500 },
    { description: t('pdfSample.material'), cents: 64_000 },
  ];
  const net = lines.reduce((sum, l) => sum + l.cents, 0);
  const vat = smallBusiness ? 0 : Number(divRoundHalfUp(BigInt(net * rate), 100n));
  const [cityZip, ...cityRest] = t('pdfSample.city').split(' ');

  return {
    language,
    watermark: t('pdf.sample'),
    style: { accentColor: style.accentColor, logoPosition: style.logoPosition, logo: style.logo },
    seller: { ...seller, name: seller.name || translate(language, 'company.name') },
    buyer: {
      name: t('pdfSample.customer'),
      attention: '',
      street: t('pdfSample.street'),
      zip: cityZip ?? '',
      city: cityRest.join(' '),
      countryCode: company.countryCode,
    },
    number: null,
    invoiceDate: today,
    serviceDateFrom: today,
    serviceDateTo: null,
    paymentTermDays: company.defaultPaymentTermDays,
    dueDate: addDays(today, company.defaultPaymentTermDays),
    siteAddress: '',
    subject: t('pdfSample.subject'),
    introText: company.introTexts[language] || t('pdfSample.intro'),
    closingText: company.closingTexts[language] || t('pdfSample.closing'),
    taxMode: company.taxMode,
    positions: lines.map((line, index) => ({
      position: index + 1,
      description: line.description,
      quantityMilli: 1000,
      unitCode: 'LS',
      unitPriceCents: line.cents,
      vatRate: rate,
      lineTotalCents: line.cents,
    })),
    totals: {
      netCents: net,
      vatGroups: smallBusiness ? [] : [{ rate, netCents: net, vatCents: vat }],
      grossCents: net + vat,
    },
  };
}
