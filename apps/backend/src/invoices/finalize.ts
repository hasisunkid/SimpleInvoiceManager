import {
  buyerSnapshot,
  calculateInvoice,
  dueDate,
  finalizeProblems,
  sellerSnapshot,
} from '@sim/domain';
import { transactionWithRetry, type Db } from '../db.js';
import { loadCompany } from '../company/repository.js';
import { findCustomer } from '../customers/repository.js';
import { reviewedColumn } from '../mcp/origin.js';
import type { FileStore } from '../files/store.js';
import { assignInvoiceNumber, loadNumbering } from '../numbering/repository.js';
import { buildInvoiceDocument, loadPrintStyle } from '../pdf/invoice-document.js';
import type { InvoiceRenderer } from '../pdf/types.js';
import { isDuplicateKeyError } from '../users/repository.js';
import { businessYear } from '../time.js';
import { findInvoice, recordStatus, replacePositions } from './repository.js';

export type FinalizeResult =
  | { readonly result: 'finalized'; readonly number: string }
  | { readonly result: 'not-found' | 'not-editable' | 'conflict' | 'number-taken' }
  | { readonly result: 'incomplete'; readonly problems: string[] };

/**
 * FR-INV-11 "Create PDF": in ONE transaction
 *   1. lock the draft and check its version (the user finalizes exactly what they saw),
 *   2. check § 14 UStG completeness (FR-INV-07),
 *   3. assign the next number under the sequence row lock (FR-NUM-02/03),
 *   4. freeze seller and buyer data (FR-COMP-05) and the tax mode,
 *   5. render and store the PDF (FR-INV-15),
 *   6. set status OPEN and log the status change (FR-INV-14).
 * Any failure – including PDF rendering – rolls everything back, so no number is lost.
 */
export async function finalizeInvoice(
  db: Db,
  files: FileStore,
  renderer: InvoiceRenderer,
  id: number,
  expectedVersion: number,
  userId: number,
): Promise<FinalizeResult> {
  try {
    return await transactionWithRetry(db, async (trx): Promise<FinalizeResult> => {
      const invoice = await findInvoice(trx, id, { forUpdate: true });
      if (!invoice) return { result: 'not-found' };
      if (invoice.status !== 'DRAFT') return { result: 'not-editable' };
      if (invoice.version !== expectedVersion) return { result: 'conflict' };

      const tx = trx as unknown as Db;
      const [{ profile }, numbering, customer] = await Promise.all([
        loadCompany(tx),
        loadNumbering(trx),
        invoice.customerId ? findCustomer(trx, invoice.customerId) : Promise.resolve(undefined),
      ]);
      const problems: string[] = finalizeProblems(invoice, customer ?? null, profile);
      if (!numbering.configured) problems.push('NUMBERING_NOT_CONFIGURED');
      if (problems.length > 0 || !customer) return { result: 'incomplete', problems };

      const { number } = await assignInvoiceNumber(trx, businessYear());
      const seller = sellerSnapshot(profile);
      const buyer = buyerSnapshot(customer);
      const taxMode = profile.taxMode;
      const { positions, totals } = calculateInvoice(invoice.positions, taxMode);

      const document = buildInvoiceDocument({
        invoice: { ...invoice, number },
        seller,
        buyer,
        taxMode,
        style: await loadPrintStyle(trx, files),
        watermark: null,
      });
      const pdf = await renderer.render(document);
      const file = await files.save(
        'INVOICE_PDF',
        pdf,
        renderer.mimeType,
        { createdBy: userId },
        trx,
      );

      await replacePositions(trx, id, positions);
      await trx('invoice')
        .where({ id })
        .update({
          status: 'OPEN',
          number,
          tax_mode: taxMode,
          seller_snapshot: JSON.stringify(seller),
          buyer_snapshot: JSON.stringify(buyer),
          due_date: dueDate(invoice.invoiceDate, invoice.paymentTermDays),
          net_total_cents: totals.netCents,
          vat_total_cents: totals.vatCents,
          gross_total_cents: totals.grossCents,
          labour_incl_vat_cents: totals.labourCostInclVatCents,
          pdf_file_id: file.id,
          pdf_sha256: file.sha256,
          // A person finalized it – that clears "Von KI erstellt" (FR-MCP-10).
          ...reviewedColumn(trx),
          finalized_at: new Date(),
          finalized_by: userId,
          version: invoice.version + 1,
          updated_by: userId,
          updated_at: new Date(),
        });
      await recordStatus(trx, id, 'DRAFT', 'OPEN', userId);
      return { result: 'finalized', number };
    });
  } catch (err) {
    // A number that already exists (e.g. the admin lowered the prefix/format in an odd way):
    // nothing was changed, the admin has to raise the next number.
    if (isDuplicateKeyError(err)) return { result: 'number-taken' };
    throw err;
  }
}
