import { divRoundHalfUp } from './money.js';
import type { TaxMode, VatRate } from './company.js';
import type { PositionType } from './units.js';

/**
 * Invoice calculation (FR-INV-06) – the only implementation, used by backend and frontend (AR-05).
 *
 *   line total   = round(quantity × unit price, 2, half-up)
 *   net total    = Σ line totals
 *   VAT per rate = round(Σ net of that rate × rate, 2, half-up)
 *   gross        = net + Σ VAT
 *
 * Amounts are integer cents, quantities integer thousandths (AR-08); intermediate products use
 * bigint, so nothing is ever rounded twice or touched by binary floating point.
 */

/** EN 16931 VAT category: S standard, Z zero rated, E exempt (§ 19 UStG). AE (§ 13b) reserved. */
export type VatCategory = 'S' | 'Z' | 'E' | 'AE';

export function vatCategory(rate: VatRate, taxMode: TaxMode): VatCategory {
  if (taxMode === 'SMALL_BUSINESS_19') return 'E';
  return rate === 0 ? 'Z' : 'S';
}

/** Upper bound for quantities: 1 000 000 units (in thousandths). */
export const MAX_QUANTITY_MILLI = 1_000_000_000;

export interface PositionAmounts {
  readonly type: PositionType;
  /** Thousandths: 1500 = 1,5. */
  readonly quantityMilli: number;
  readonly unitPriceCents: number;
  readonly vatRate: VatRate;
}

export function lineTotalCents(quantityMilli: number, unitPriceCents: number): number {
  return Number(divRoundHalfUp(BigInt(quantityMilli) * BigInt(unitPriceCents), 1000n));
}

export interface VatGroup {
  readonly rate: VatRate;
  readonly netCents: number;
  readonly vatCents: number;
}

export interface InvoiceTotals {
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
  /** One group per VAT rate in use, highest rate first; empty for § 19 invoices. */
  readonly vatGroups: readonly VatGroup[];
  /** FR-INV-04: net subtotal per section. */
  readonly sections: Readonly<Record<PositionType, { readonly netCents: number }>>;
  /**
   * § 35a EStG: labour costs including VAT – printed for private customers (FR-INV-04).
   * Computed per VAT rate with the same rounding as the invoice VAT.
   */
  readonly labourCostInclVatCents: number;
}

export type CalculatedPosition<T extends PositionAmounts> = T & {
  readonly lineTotalCents: number;
  /** Effective rate: always 0 for § 19 invoices. */
  readonly vatRate: VatRate;
  readonly vatCategory: VatCategory;
};

function vatOf(netCents: number, rate: VatRate): number {
  return Number(divRoundHalfUp(BigInt(netCents) * BigInt(rate), 100n));
}

function netByRate(positions: readonly { vatRate: VatRate; lineTotalCents: number }[]) {
  const map = new Map<VatRate, number>();
  for (const p of positions) map.set(p.vatRate, (map.get(p.vatRate) ?? 0) + p.lineTotalCents);
  return [...map.entries()].sort(([a], [b]) => b - a);
}

export function calculateInvoice<T extends PositionAmounts>(
  positions: readonly T[],
  taxMode: TaxMode,
): { positions: CalculatedPosition<T>[]; totals: InvoiceTotals } {
  const smallBusiness = taxMode === 'SMALL_BUSINESS_19';
  const calculated = positions.map((p) => {
    const rate: VatRate = smallBusiness ? 0 : p.vatRate;
    return {
      ...p,
      vatRate: rate,
      vatCategory: vatCategory(rate, taxMode),
      lineTotalCents: lineTotalCents(p.quantityMilli, p.unitPriceCents),
    };
  });

  const netCents = calculated.reduce((sum, p) => sum + p.lineTotalCents, 0);
  const vatGroups: VatGroup[] = smallBusiness
    ? []
    : netByRate(calculated).map(([rate, net]) => ({
        rate,
        netCents: net,
        vatCents: vatOf(net, rate),
      }));
  const vatCents = vatGroups.reduce((sum, g) => sum + g.vatCents, 0);

  const sectionNet = (type: PositionType) =>
    calculated.filter((p) => p.type === type).reduce((sum, p) => sum + p.lineTotalCents, 0);
  const work = calculated.filter((p) => p.type === 'WORK');
  const workNet = sectionNet('WORK');
  const workVat = smallBusiness
    ? 0
    : netByRate(work).reduce((sum, [rate, net]) => sum + vatOf(net, rate), 0);

  return {
    positions: calculated,
    totals: {
      netCents,
      vatCents,
      grossCents: netCents + vatCents,
      vatGroups,
      sections: { WORK: { netCents: workNet }, MATERIAL: { netCents: sectionNet('MATERIAL') } },
      labourCostInclVatCents: workNet + workVat,
    },
  };
}
