/**
 * FR-CAT-02: units offered in the UI, stored as UN/ECE Recommendation 20 codes so a later
 * ZUGFeRD export (§8) can use them directly. Labels live in i18n (`units.*`, `unitNames.*`).
 */
export const UNIT_CODES = ['HUR', 'H87', 'MTR', 'MTK', 'MTQ', 'KGM', 'LS'] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

/** "pauschal" – lump sum, used by most reference invoice positions (FR-INV-03). */
export const LUMP_SUM_UNIT: UnitCode = 'LS';

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === 'string' && (UNIT_CODES as readonly string[]).includes(value);
}

/** FR-CAT-01 / FR-INV-03: every position is either labour or material (§ 35a EStG split). */
export const POSITION_TYPES = ['WORK', 'MATERIAL'] as const;
export type PositionType = (typeof POSITION_TYPES)[number];
