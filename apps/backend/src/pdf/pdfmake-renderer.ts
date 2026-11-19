import { createRequire } from 'node:module';
import type * as PdfMake from 'pdfmake';
import type { Content, TableCell } from 'pdfmake';
import { formatDate, formatMoney, formatQuantity, cents } from '@sim/domain';
import { translate, type MessageKey } from '@sim/i18n';
import { FONT_DIR, ROBOTO } from './fonts.js';
import type { InvoiceDocument, InvoiceRenderer } from './types.js';

// pdfmake is CommonJS exporting one configured instance; createRequire keeps its typings.
const pdfmake = createRequire(import.meta.url)('pdfmake') as typeof PdfMake;

type TDocumentDefinitions = Parameters<typeof pdfmake.createPdf>[0];

pdfmake.setFonts({ Roboto: ROBOTO });
// NFR-SEC-01: never fetch URLs while rendering; local access only to the bundled fonts.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((file) => file.startsWith(FONT_DIR));

const MM = 72 / 25.4;
const PAGE_WIDTH = 210 * MM;
const MARGIN = { left: 25 * MM, top: 20 * MM, right: 20 * MM, bottom: 34 * MM };
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;
const TEXT_COLOR = '#1C2430';
const MUTED_COLOR = '#5A6573';
const GRID_COLOR = '#9AA5B1';

/** DIN 5008 form B: window address field and information block positions. */
const DIN = {
  senderLineY: 50 * MM,
  addressY: 62.7 * MM,
  infoBlockX: 125 * MM,
  infoBlockY: 50 * MM,
  infoBlockWidth: 65 * MM, // ends at the right margin (190 mm)
  bodyStartY: 98.5 * MM,
};

function dataUrl(data: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

/**
 * Plain-PDF invoice renderer following the reference invoices (Appendix A, FR-PDF-01..03):
 * accent line and company name/logo on top, DIN 5008 window address, information block,
 * centred title, position table with repeated header, totals, footer in three columns.
 */
export class PdfMakeInvoiceRenderer implements InvoiceRenderer {
  readonly mimeType = 'application/pdf';

  async render(doc: InvoiceDocument): Promise<Buffer> {
    return pdfmake.createPdf(this.definition(doc)).getBuffer();
  }

  /** Builds the pdfmake definition – exposed for tests. */
  definition(doc: InvoiceDocument): TDocumentDefinitions {
    const lang = doc.language;
    const t = (key: MessageKey, params?: Record<string, string | number>) =>
      translate(lang, key, params);
    const money = (value: number) => formatMoney(cents(value), lang);
    const date = (value: string) => formatDate(value, lang);
    const accent = doc.style.accentColor;
    const seller = doc.seller;
    const smallBusiness = doc.taxMode === 'SMALL_BUSINESS_19';

    // ----- first-page header: accent line + logo or company name -----
    const brand: Content = doc.style.logo
      ? {
          image: dataUrl(doc.style.logo.data, doc.style.logo.mimeType),
          fit: [65 * MM, 22 * MM],
          alignment: doc.style.logoPosition === 'RIGHT' ? 'right' : 'left',
        }
      : {
          text: seller.name.toUpperCase(),
          fontSize: 20,
          bold: true,
          color: accent,
          characterSpacing: 1,
          alignment: doc.style.logoPosition === 'RIGHT' ? 'right' : 'left',
        };

    const header: Content[] = [
      {
        absolutePosition: { x: MARGIN.left, y: 12 * MM },
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: CONTENT_WIDTH,
            y2: 0,
            lineWidth: 2.5,
            lineColor: accent,
          },
        ],
      },
      {
        // A one-cell table gives the brand a fixed width, so left/right alignment works.
        absolutePosition: { x: MARGIN.left, y: 16 * MM },
        table: { widths: [CONTENT_WIDTH], body: [[brand]] },
        layout: {
          defaultBorder: false,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
    ];

    // ----- DIN 5008 address field: sender line + recipient -----
    const senderLine = [seller.name, seller.street, `${seller.zip} ${seller.city}`]
      .filter((part) => part.trim())
      .join(' · ');
    const buyer = doc.buyer;
    const recipient = [
      buyer.name,
      buyer.attention ? `${t('pdf.attention')} ${buyer.attention}` : '',
      buyer.street,
      `${buyer.zip} ${buyer.city}`.trim(),
      buyer.countryCode && buyer.countryCode !== seller.countryCode ? buyer.countryCode : '',
    ].filter(Boolean);

    const address: Content[] = [
      {
        absolutePosition: { x: MARGIN.left, y: DIN.senderLineY },
        text: senderLine,
        fontSize: 7,
        color: MUTED_COLOR,
        decoration: 'underline',
      },
      {
        absolutePosition: { x: MARGIN.left, y: DIN.addressY },
        stack: recipient.map((line) => ({ text: line })),
        fontSize: 10,
        lineHeight: 1.15,
      },
    ];

    // ----- information block (right) -----
    const serviceValue = doc.serviceDateTo
      ? `${date(doc.serviceDateFrom)} – ${date(doc.serviceDateTo)}`
      : date(doc.serviceDateFrom);
    const info: [string, string][] = [
      [t('pdf.date'), date(doc.invoiceDate)],
      ...(doc.number ? ([[t('pdf.invoiceNumber'), doc.number]] as [string, string][]) : []),
      [doc.serviceDateTo ? t('pdf.servicePeriod') : t('pdf.serviceDate'), serviceValue],
      [t('pdf.paymentTerm'), t('pdf.days', { days: doc.paymentTermDays })],
      [t('pdf.dueDate'), date(doc.dueDate)],
    ];
    const infoBlock: Content = {
      absolutePosition: { x: DIN.infoBlockX, y: DIN.infoBlockY },
      table: {
        widths: [32 * MM, DIN.infoBlockWidth - 32 * MM - 8],
        body: info.map(([label, value]) => [
          { text: label, color: MUTED_COLOR },
          { text: value, alignment: 'right' },
        ]),
      },
      layout: 'noBorders',
      fontSize: 9,
    };

    // ----- body -----
    const body: Content[] = [{ text: '', margin: [0, DIN.bodyStartY - MARGIN.top, 0, 0] }];
    if (doc.subject.trim()) body.push({ text: doc.subject, bold: true, margin: [0, 0, 0, 4] });
    if (doc.siteAddress.trim()) {
      body.push({
        text: [
          { text: `${t('pdf.site')}: `, color: MUTED_COLOR },
          doc.siteAddress.replace(/\n/g, ', '),
        ],
        margin: [0, 0, 0, 4],
      });
    }
    body.push({
      text: doc.number ? `${t('pdf.invoice')} ${doc.number}` : t('pdf.invoice'),
      alignment: 'center',
      fontSize: 16,
      bold: true,
      color: accent,
      margin: [0, 12, 0, 12],
    });
    if (doc.introText.trim()) body.push({ text: doc.introText, margin: [0, 0, 0, 10] });

    const headerCell = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({
      text,
      bold: true,
      color: '#FFFFFF',
      fillColor: accent,
      alignment,
    });
    const rows: TableCell[][] = [
      [
        headerCell(t('pdf.pos')),
        headerCell(t('pdf.description')),
        headerCell(t('pdf.quantity'), 'right'),
        headerCell(t('pdf.unitPrice'), 'right'),
        headerCell(t('pdf.lineTotal'), 'right'),
      ],
      ...doc.positions.map((p): TableCell[] => [
        { text: String(p.position) },
        { text: p.description },
        {
          text: `${formatQuantity(p.quantityMilli, lang)} ${t(`units.${p.unitCode}` as MessageKey)}`,
          alignment: 'right',
        },
        { text: money(p.unitPriceCents), alignment: 'right' },
        { text: money(p.lineTotalCents), alignment: 'right' },
      ]),
    ];
    body.push({
      table: {
        headerRows: 1,
        dontBreakRows: true, // FR-PDF-02: never split a position across pages
        widths: [24, '*', 62, 68, 72],
        body: rows,
      },
      layout: {
        hLineWidth: (i) => (i === 0 ? 0 : 0.6),
        vLineWidth: () => 0.6,
        hLineColor: () => GRID_COLOR,
        vLineColor: () => GRID_COLOR,
        hLineStyle: (i) => (i <= 1 ? null : { dash: { length: 1, space: 1.5 } }),
        vLineStyle: () => ({ dash: { length: 1, space: 1.5 } }),
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      fontSize: 9.5,
    });

    // ----- totals -----
    const totalRows: TableCell[][] = [];
    if (!smallBusiness) {
      totalRows.push([t('pdf.subtotal'), { text: money(doc.totals.netCents), alignment: 'right' }]);
      for (const group of doc.totals.vatGroups) {
        totalRows.push([
          t('pdf.vatRate', { rate: group.rate }),
          { text: money(group.vatCents), alignment: 'right' },
        ]);
      }
    }
    totalRows.push([
      { text: t('pdf.total'), bold: true, color: accent },
      { text: money(doc.totals.grossCents), bold: true, color: accent, alignment: 'right' },
    ]);
    body.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 220,
          table: { widths: ['*', 90], body: totalRows },
          layout: {
            hLineWidth: (i, node) => (i === node.table.body.length - 1 ? 1 : 0),
            vLineWidth: () => 0,
            hLineColor: () => accent,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
        },
      ],
      margin: [0, 8, 0, 0],
      unbreakable: true,
    });
    if (smallBusiness) {
      body.push({ text: t('pdf.smallBusinessNote'), margin: [0, 10, 0, 0] });
    }

    // ----- closing -----
    const closing: Content[] = [];
    if (doc.closingText.trim()) closing.push({ text: doc.closingText, margin: [0, 0, 0, 10] });
    closing.push({ text: t('pdf.greeting') });
    if (seller.signatureName) closing.push({ text: seller.signatureName, margin: [0, 16, 0, 0] });
    body.push({ stack: closing, margin: [0, 18, 0, 0], unbreakable: true });

    // ----- footer on every page (FR-PDF-01/02) -----
    const footerColumns: string[][] = [
      [
        seller.name,
        seller.ownerName !== seller.name ? seller.ownerName : '',
        seller.street,
        `${seller.zip} ${seller.city}`,
      ],
      [
        seller.phone ? `${t('pdf.phone')} ${seller.phone}` : '',
        seller.mobile ? `${t('pdf.mobile')} ${seller.mobile}` : '',
        seller.email ? `${t('pdf.email')} ${seller.email}` : '',
        seller.taxNumber ? `${t('pdf.taxNumber')} ${seller.taxNumber}` : '',
        seller.vatId ? `${t('pdf.vatId')} ${seller.vatId}` : '',
      ],
      [
        seller.bankName,
        seller.iban ? `${t('pdf.iban')} ${seller.iban}` : '',
        seller.bic ? `${t('pdf.bic')} ${seller.bic}` : '',
      ],
    ].map((lines) => lines.filter((line) => line.trim()));

    return {
      pageSize: 'A4',
      pageMargins: [MARGIN.left, MARGIN.top, MARGIN.right, MARGIN.bottom],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: TEXT_COLOR, lineHeight: 1.2 },
      info: {
        title: doc.number ? `${t('pdf.invoice')} ${doc.number}` : t('pdf.invoice'),
        author: seller.name,
        creator: 'SimpleInvoice Manager',
        producer: 'SimpleInvoice Manager',
      },
      ...(doc.watermark
        ? { watermark: { text: doc.watermark, color: accent, opacity: 0.12, bold: true } }
        : {}),
      content: [...header, ...address, infoBlock, ...body],
      footer: (currentPage, pageCount) => ({
        margin: [MARGIN.left, 10, MARGIN.right, 0],
        stack: [
          {
            canvas: [
              {
                type: 'line',
                x1: 0,
                y1: 0,
                x2: CONTENT_WIDTH,
                y2: 0,
                lineWidth: 0.75,
                lineColor: accent,
              },
            ],
          },
          {
            columns: footerColumns.map((lines) => ({ stack: lines, width: '*' })),
            columnGap: 12,
            fontSize: 7.5,
            color: accent,
            lineHeight: 1.15,
            margin: [0, 5, 0, 0],
          },
          {
            text: t('pdf.page', { page: currentPage, pages: pageCount }),
            alignment: 'right',
            fontSize: 7,
            color: MUTED_COLOR,
            margin: [0, 4, 0, 0],
          },
        ],
      }),
    };
  }
}

/** Checks that pdfmake can embed an image (catches corrupt or unsupported PNG/JPEG early). */
export async function canEmbedImage(data: Buffer, mimeType: string): Promise<boolean> {
  try {
    await pdfmake
      .createPdf({ content: [{ image: dataUrl(data, mimeType), width: 50 }] })
      .getBuffer();
    return true;
  } catch {
    return false;
  }
}
