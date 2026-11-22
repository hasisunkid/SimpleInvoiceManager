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

/** Names an AI assistant (or a person) may use for a unit, mapped to the code (FR-MCP-09). */
const UNIT_ALIASES: Readonly<Record<string, UnitCode>> = {
  hur: 'HUR',
  h: 'HUR',
  std: 'HUR',
  stunde: 'HUR',
  stunden: 'HUR',
  hour: 'HUR',
  hours: 'HUR',
  hr: 'HUR',
  godz: 'HUR',
  godzina: 'HUR',
  h87: 'H87',
  stk: 'H87',
  stück: 'H87',
  stueck: 'H87',
  piece: 'H87',
  pieces: 'H87',
  pcs: 'H87',
  pc: 'H87',
  szt: 'H87',
  mtr: 'MTR',
  m: 'MTR',
  meter: 'MTR',
  metre: 'MTR',
  mtk: 'MTK',
  m2: 'MTK',
  'm²': 'MTK',
  qm: 'MTK',
  sqm: 'MTK',
  mtq: 'MTQ',
  m3: 'MTQ',
  'm³': 'MTQ',
  cbm: 'MTQ',
  kgm: 'KGM',
  kg: 'KGM',
  ls: 'LS',
  pauschal: 'LS',
  pauschale: 'LS',
  psch: 'LS',
  'lump sum': 'LS',
  lumpsum: 'LS',
  flat: 'LS',
  ryczałt: 'LS',
  ryczalt: 'LS',
};

/** "Std.", "h", "m²", "pauschal", "HUR" … → unit code; null if unknown. */
export function parseUnit(input: string): UnitCode | null {
  const key = input.trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[key] ?? null;
}
