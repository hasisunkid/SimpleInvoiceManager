import { nextStatus, type InvoiceAction, type InvoiceStatus } from '@sim/domain';
import { transactionWithRetry, type Db } from '../db.js';
import { recordStatus } from './repository.js';

export type StatusChangeResult =
  | { readonly result: 'changed'; readonly status: InvoiceStatus }
  | { readonly result: 'not-found' | 'conflict' }
  | { readonly result: 'not-allowed'; readonly status: InvoiceStatus };

interface Row {
  status: InvoiceStatus;
  version: number;
}

/**
 * FR-INV-14: pay / undo payment / cancel. Row lock + version check like every other write;
 * the transition table lives in the domain package; every change is logged with user and time
 * (history note: payment date or cancel reason).
 */
export async function changeStatus(
  db: Db,
  id: number,
  action: Exclude<InvoiceAction, 'FINALIZE'>,
  expectedVersion: number,
  userId: number,
  details: { paidAt?: string; reason?: string } = {},
): Promise<StatusChangeResult> {
  return transactionWithRetry(db, async (trx) => {
    const row = await trx<Row & { id: number }>('invoice')
      .select('status', 'version')
      .where({ id })
      .forUpdate()
      .first();
    if (!row) return { result: 'not-found' };
    if (row.version !== expectedVersion) return { result: 'conflict' };
    const to = nextStatus(row.status, action);
    if (!to) return { result: 'not-allowed', status: row.status };

    const now = new Date();
    const changes: Record<string, unknown> = {
      status: to,
      version: row.version + 1,
      updated_by: userId,
      updated_at: now,
    };
    let note: string | null = null;
    if (action === 'PAY') {
      changes.paid_at = details.paidAt;
      note = details.paidAt ?? null;
    } else if (action === 'UNPAY') {
      changes.paid_at = null;
    } else {
      changes.cancelled_at = now;
      changes.cancel_reason = details.reason;
      note = details.reason ?? null;
    }
    await trx('invoice').where({ id }).update(changes);
    await recordStatus(trx, id, row.status, to, userId, note);
    return { result: 'changed', status: to };
  });
}
