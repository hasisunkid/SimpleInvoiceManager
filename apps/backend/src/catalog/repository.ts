import type { CatalogItemData, PositionType, UnitCode, VatRate } from '@sim/domain';
import type { Db } from '../db.js';
import { likePattern, searchTerms } from '../customers/repository.js';
import {
  aiCreatedSql,
  isAiCreated,
  originColumns,
  reviewedColumn,
  UI_ORIGIN,
  type Origin,
} from '../mcp/origin.js';

interface CatalogRow {
  id: number;
  type: PositionType;
  title: string;
  description: string;
  unit_code: UnitCode;
  unit_price_cents: number;
  vat_rate: VatRate;
  active: number | boolean;
  created_via: 'UI' | 'MCP';
  ai_reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CatalogItem extends CatalogItemData {
  id: number;
  /** FR-MCP-10: created by an AI assistant and not yet checked by a person. */
  aiCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

function toItem(row: CatalogRow): CatalogItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    unitCode: row.unit_code,
    unitPriceCents: row.unit_price_cents,
    vatRate: row.vat_rate,
    active: Boolean(row.active),
    aiCreated: isAiCreated(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toRow(item: CatalogItemData) {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    unit_code: item.unitCode,
    unit_price_cents: item.unitPriceCents,
    vat_rate: item.vatRate,
    active: item.active,
  };
}

export interface CatalogQuery {
  q?: string;
  type?: PositionType;
  includeInactive?: boolean;
  /** FR-MCP-10 filter "Von KI erstellt". */
  aiCreated?: boolean;
}

/** FR-CAT-03: search the catalogue by title and description; active items only by default. */
export async function searchCatalog(
  db: Db,
  { q, type, includeInactive = false, aiCreated = false }: CatalogQuery,
): Promise<CatalogItem[]> {
  const rows = await db<CatalogRow>('catalog_item')
    .modify((query) => {
      if (!includeInactive) query.where('active', true);
      if (type) query.where('type', type);
      if (aiCreated) query.whereRaw(aiCreatedSql());
      for (const term of searchTerms(q)) {
        const pattern = likePattern(term);
        query.where((w) =>
          w.where('title', 'like', pattern).orWhere('description', 'like', pattern),
        );
      }
    })
    .orderBy([
      { column: 'active', order: 'desc' },
      { column: 'type', order: 'asc' }, // ENUM order: WORK before MATERIAL
      { column: 'title', order: 'asc' },
    ])
    .limit(500);
  return rows.map(toItem);
}

export async function findCatalogItem(db: Db, id: number): Promise<CatalogItem | undefined> {
  const row = await db<CatalogRow>('catalog_item').where({ id }).first();
  return row ? toItem(row) : undefined;
}

export async function insertCatalogItem(
  db: Db,
  item: CatalogItemData,
  userId: number | null,
  origin: Origin = UI_ORIGIN,
): Promise<number> {
  const [id] = await db('catalog_item').insert({
    ...toRow(item),
    ...originColumns(origin),
    created_by: userId,
    updated_by: userId,
  });
  return id as number;
}

export async function updateCatalogItem(
  db: Db,
  id: number,
  item: CatalogItemData,
  userId: number,
): Promise<boolean> {
  const n = await db('catalog_item')
    .where({ id })
    // A person edited and saved it: no longer "Von KI erstellt" (FR-MCP-10).
    .update({ ...toRow(item), ...reviewedColumn(db), updated_by: userId, updated_at: new Date() });
  return n > 0;
}

/** FR-MCP-10: a person confirmed the AI-created entry ("Geprüft"). */
export async function markCatalogItemReviewed(
  db: Db,
  id: number,
  userId: number,
): Promise<boolean> {
  const n = await db('catalog_item')
    .where({ id })
    .update({ ...reviewedColumn(db), updated_by: userId, updated_at: new Date() });
  return n > 0;
}

/** Items are copied into invoices (FR-CAT-03), so deleting one never affects invoices. */
export async function deleteCatalogItem(db: Db, id: number): Promise<boolean> {
  return (await db('catalog_item').where({ id }).delete()) > 0;
}
