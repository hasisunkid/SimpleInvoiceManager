/**
 * Invoice number range (FR-NUM-01..04).
 *
 * Numbers look like `{prefix}{value}`, where the prefix may contain `{YYYY}` (four-digit year)
 * and the value can be zero-padded to `minDigits`. Default: plain integer ("104").
 */

export const YEAR_PLACEHOLDER = '{YYYY}';
export const MAX_PREFIX_LENGTH = 20;
export const MAX_MIN_DIGITS = 8;
export const MAX_NUMBER_VALUE = 99_999_999;

export interface NumberingSettings {
  readonly prefix: string;
  readonly minDigits: number;
  readonly nextValue: number;
  readonly resetYearly: boolean;
}

export interface NumberingState extends NumberingSettings {
  /** Year of the last assignment; null before the first invoice. */
  readonly currentYear: number | null;
  /** Last assigned value in the current period; null if none yet. */
  readonly lastAssigned: number | null;
}

export type NumberingProblem =
  | 'PREFIX_INVALID'
  | 'MIN_DIGITS_INVALID'
  | 'NEXT_VALUE_INVALID'
  | 'NEXT_VALUE_TOO_LOW'
  | 'YEARLY_RESET_NEEDS_YEAR';

/** Letters, digits and - _ / . plus the year placeholder; keeps numbers safe in file names. */
const PREFIX_PATTERN = /^(?:[A-Za-z0-9\-_/.]|\{YYYY\})*$/;

export function formatInvoiceNumber(
  settings: Pick<NumberingSettings, 'prefix' | 'minDigits'>,
  value: number,
  year: number,
): string {
  const prefix = settings.prefix.split(YEAR_PLACEHOLDER).join(String(year).padStart(4, '0'));
  return `${prefix}${String(value).padStart(settings.minDigits, '0')}`;
}

/** The value the next finalization would get in `year` (after a possible yearly reset). */
export function effectiveNextValue(state: NumberingState, year: number): number {
  return resetsIn(state, year) ? 1 : state.nextValue;
}

function resetsIn(state: NumberingState, year: number): boolean {
  return state.resetYearly && state.currentYear !== null && year > state.currentYear;
}

/**
 * Validates new settings against the current state. FR-NUM-04: the next number may be raised
 * but never set to or below a number already used in the current period.
 */
export function validateNumbering(
  settings: NumberingSettings,
  state: NumberingState,
  year: number,
): NumberingProblem[] {
  const problems: NumberingProblem[] = [];
  if (settings.prefix.length > MAX_PREFIX_LENGTH || !PREFIX_PATTERN.test(settings.prefix)) {
    problems.push('PREFIX_INVALID');
  }
  if (
    !Number.isInteger(settings.minDigits) ||
    settings.minDigits < 0 ||
    settings.minDigits > MAX_MIN_DIGITS
  ) {
    problems.push('MIN_DIGITS_INVALID');
  }
  if (
    !Number.isInteger(settings.nextValue) ||
    settings.nextValue < 1 ||
    settings.nextValue > MAX_NUMBER_VALUE
  ) {
    problems.push('NEXT_VALUE_INVALID');
  } else {
    // A yearly reset that is due makes the old period's numbers irrelevant.
    const lastUsed = resetsIn({ ...state, resetYearly: settings.resetYearly }, year)
      ? null
      : state.lastAssigned;
    if (lastUsed !== null && settings.nextValue <= lastUsed) problems.push('NEXT_VALUE_TOO_LOW');
  }
  // Without the year in the number, a yearly reset would produce duplicates.
  if (settings.resetYearly && !settings.prefix.includes(YEAR_PLACEHOLDER)) {
    problems.push('YEARLY_RESET_NEEDS_YEAR');
  }
  return problems;
}

/**
 * New state after an admin saved (already validated) settings. If a yearly reset is due, the
 * new period starts now with the chosen start number, so the reset is not applied twice.
 */
export function applyNumberingSettings(
  state: NumberingState,
  settings: NumberingSettings,
  year: number,
): NumberingState {
  const startsNewPeriod = resetsIn({ ...state, resetYearly: settings.resetYearly }, year);
  return {
    ...state,
    ...settings,
    ...(startsNewPeriod ? { currentYear: year, lastAssigned: null } : {}),
  };
}

export interface Assignment {
  readonly value: number;
  readonly number: string;
  readonly state: NumberingState;
}

/**
 * Assigns the next number for a finalization in `year` (FR-NUM-02). Pure: the caller must run
 * it inside the same DB transaction that locks the sequence row and finalizes the invoice, so a
 * rollback never leaves a gap (FR-NUM-03).
 */
export function assignNumber(state: NumberingState, year: number): Assignment {
  const reset = resetsIn(state, year);
  const value = reset ? 1 : state.nextValue;
  if (value > MAX_NUMBER_VALUE) throw new RangeError('Invoice number range exhausted');
  return {
    value,
    number: formatInvoiceNumber(state, value, year),
    state: {
      ...state,
      nextValue: value + 1,
      lastAssigned: value,
      currentYear: Math.max(year, state.currentYear ?? year),
    },
  };
}
