import type { Knex } from 'knex';

/**
 * FR-MCP-10: who created a record. Records created through MCP carry the marker until a human
 * edits and saves them, confirms them ("Geprüft"), or – for invoices – finalizes them.
 */
export interface Origin {
  readonly via: 'UI' | 'MCP';
  readonly tokenId?: number;
}

export const UI_ORIGIN: Origin = { via: 'UI' };

export function originColumns(origin: Origin) {
  return origin.via === 'MCP'
    ? { created_via: 'MCP', created_via_token_id: origin.tokenId ?? null }
    : { created_via: 'UI' };
}

/** SQL condition "still marked as AI-created" for a table alias (or the bare table). */
export function aiCreatedSql(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}created_via = 'MCP' AND ${p}ai_reviewed_at IS NULL)`;
}

export function isAiCreated(row: { created_via?: string; ai_reviewed_at?: Date | null }): boolean {
  return row.created_via === 'MCP' && !row.ai_reviewed_at;
}

/** Column update that clears the marker (keeps the first review time). */
export function reviewedColumn(db: Knex | Knex.Transaction) {
  return { ai_reviewed_at: db.raw('COALESCE(ai_reviewed_at, NOW())') };
}
