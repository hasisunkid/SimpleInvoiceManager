import type { Knex } from 'knex';
import { assignNumber, type NumberingState } from '@sim/domain';
import type { Db } from '../db.js';

interface SequenceRow {
  id: number;
  prefix: string;
  min_digits: number;
  next_value: number;
  reset_yearly: number | boolean;
  current_year: number | null;
  last_assigned: number | null;
  configured: number | boolean;
}

export interface StoredNumbering {
  state: NumberingState;
  configured: boolean;
}

function toState(row: SequenceRow): StoredNumbering {
  return {
    state: {
      prefix: row.prefix,
      minDigits: row.min_digits,
      nextValue: row.next_value,
      resetYearly: Boolean(row.reset_yearly),
      currentYear: row.current_year,
      lastAssigned: row.last_assigned,
    },
    configured: Boolean(row.configured),
  };
}

/** Reads the sequence; with `forUpdate` the row stays locked until the transaction ends. */
export async function loadNumbering(
  db: Db | Knex.Transaction,
  { forUpdate = false } = {},
): Promise<StoredNumbering> {
  const query = db<SequenceRow>('number_sequence').where({ id: 1 });
  if (forUpdate) query.forUpdate();
  const row = await query.first();
  if (!row) throw new Error('number_sequence row missing – migration 0003 not applied?');
  return toState(row);
}

export async function saveNumbering(
  trx: Knex.Transaction,
  state: NumberingState,
  userId: number | null,
): Promise<void> {
  await trx('number_sequence')
    .where({ id: 1 })
    .update({
      prefix: state.prefix,
      min_digits: state.minDigits,
      next_value: state.nextValue,
      reset_yearly: state.resetYearly,
      current_year: state.currentYear,
      last_assigned: state.lastAssigned,
      configured: true,
      ...(userId !== null ? { updated_by: userId, updated_at: new Date() } : {}),
    });
}

export class NumberingNotConfiguredError extends Error {
  constructor() {
    super('The invoice number range has not been configured yet');
    this.name = 'NumberingNotConfiguredError';
  }
}

/**
 * FR-NUM-02/03: assigns the next invoice number **inside the caller's transaction** (the one
 * that finalizes the invoice). The sequence row is locked with SELECT … FOR UPDATE, so parallel
 * finalizations are serialized, and a rollback releases the number again – no gaps.
 */
export async function assignInvoiceNumber(
  trx: Knex.Transaction,
  year: number,
): Promise<{ number: string; value: number }> {
  const { state, configured } = await loadNumbering(trx, { forUpdate: true });
  if (!configured) throw new NumberingNotConfiguredError();
  const assignment = assignNumber(state, year);
  await trx('number_sequence').where({ id: 1 }).update({
    next_value: assignment.state.nextValue,
    last_assigned: assignment.state.lastAssigned,
    current_year: assignment.state.currentYear,
  });
  return { number: assignment.number, value: assignment.value };
}
