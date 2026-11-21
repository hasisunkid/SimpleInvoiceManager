import type { VatRate } from './company.js';
import type { PositionType, UnitCode } from './units.js';

/** Upper bound for a single unit price: 10 million euros, in cents. */
export const MAX_UNIT_PRICE_CENTS = 1_000_000_000;

/** FR-CAT-01: reusable position template. Values are copied into invoices (FR-CAT-03). */
export interface CatalogItemData {
  readonly type: PositionType;
  readonly title: string;
  readonly description: string;
  readonly unitCode: UnitCode;
  /** Net price per unit in cents. */
  readonly unitPriceCents: number;
  readonly vatRate: VatRate;
  readonly active: boolean;
}

export type CatalogProblem = 'TITLE_REQUIRED' | 'INVALID_PRICE';

export function validateCatalogItem(
  item: CatalogItemData,
): Partial<Record<keyof CatalogItemData, CatalogProblem>> {
  const problems: Partial<Record<keyof CatalogItemData, CatalogProblem>> = {};
  if (!item.title.trim()) problems.title = 'TITLE_REQUIRED';
  if (
    !Number.isSafeInteger(item.unitPriceCents) ||
    item.unitPriceCents < 0 ||
    item.unitPriceCents > MAX_UNIT_PRICE_CENTS
  ) {
    problems.unitPriceCents = 'INVALID_PRICE';
  }
  return problems;
}
