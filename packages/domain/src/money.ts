/**
 * Money is always an integer number of euro cents (AR-08).
 * Binary floating point is never used for amounts.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export type DocumentLanguage = 'de' | 'pl' | 'en';

const LOCALE: Readonly<Record<DocumentLanguage, string>> = {
  de: 'de-DE',
  pl: 'pl-PL',
  en: 'en-GB',
};

/** Brands a value as cents, rejecting anything that is not a safe integer. */
export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money amount must be an integer number of cents, got ${value}`);
  }
  return value as Cents;
}

export function addCents(...values: readonly Cents[]): Cents {
  return cents(values.reduce<number>((sum, v) => sum + v, 0));
}

/**
 * Integer division rounded half away from zero ("kaufmännisch runden").
 * Works purely on bigint so no precision is lost for large intermediate products.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** German/Polish style "1.755,00" and English style "1,755.00"; at most two decimals. */
const MONEY_GRAMMARS: readonly RegExp[] = [
  /^(\d{1,3}(?:\.\d{3})+|\d*)(?:,(\d{1,2}))?$/,
  /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{1,2}))?$/,
];

/**
 * Parses a user-entered amount ("1.755,00", "1,755.00", "1755.5", "15,2", "80") into cents.
 * A separator followed by exactly three digits is a thousands separator ("1.234" = 1234 €).
 * Returns null for anything ambiguous or malformed.
 */
export function parseMoney(input: string): Cents | null {
  const s = input.replace(/[\s\u00a0\u202f€]/g, '');
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  for (const grammar of MONEY_GRAMMARS) {
    const m = grammar.exec(body);
    if (!m) continue;
    const intPart = (m[1] ?? '').replace(/[.,]/g, '');
    const fracPart = m[2] ?? '';
    if (intPart === '' && fracPart === '') return null;
    const value = Number(intPart || '0') * 100 + Number(fracPart.padEnd(2, '0'));
    if (!Number.isSafeInteger(value)) return null;
    return cents(negative ? -value : value);
  }
  return null;
}

/** Formats cents for display / PDF in the document language (FR-I18N-03): "1.755,00 €". */
export function formatMoney(amount: Cents, language: DocumentLanguage): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  const intText = new Intl.NumberFormat(LOCALE[language], { useGrouping: true }).format(euros);
  const decimalSep = language === 'en' ? '.' : ',';
  const text = `${intText}${decimalSep}${String(rest).padStart(2, '0')}`;
  const signed = negative ? `-${text}` : text;
  return language === 'en' ? `€${signed}`.replace('€-', '-€') : `${signed} €`;
}

/**
 * Quantities are stored as integer thousandths (FR-INV-03: 3 decimals), e.g. 1.5 h = 1500.
 * Formatting drops trailing zeros: 1000 → "1", 1500 → "1,5", 1250 → "1,25".
 */
export function formatQuantity(milli: number, language: DocumentLanguage): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError(`Invalid quantity ${milli}`);
  const negative = milli < 0;
  const abs = Math.abs(milli);
  const whole = new Intl.NumberFormat(LOCALE[language], { useGrouping: true }).format(
    Math.trunc(abs / 1000),
  );
  const frac = String(abs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const text = frac ? `${whole}${language === 'en' ? '.' : ','}${frac}` : whole;
  return negative ? `-${text}` : text;
}

/**
 * Parses a quantity with up to three decimals ("1", "1,5", "2.25", "0,125") into thousandths.
 * Both "," and "." are decimal separators; thousands separators are not accepted, so
 * "1,250" is 1.25 – never 1250. Returns null if unparseable.
 */
export function parseQuantity(input: string): number | null {
  const m = /^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(input.replace(/\s+/g, ''));
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

/**
 * FR-MCP-09: machine input (MCP tools) uses plain decimal strings with "." – "1755.00",
 * "48", "0.5" – never floating point numbers. Stricter than parseMoney: no thousands
 * separators, at most two decimals, no sign. Returns null if invalid.
 */
export function parseDecimalAmount(input: string): Cents | null {
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return cents(Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')));
}

/** FR-MCP-09: decimal string with "." and up to three decimals ("2.5", "0.125") → thousandths. */
export function parseDecimalQuantity(input: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

/** Inverse of parseDecimalAmount for machine output: 175500 → "1755.00". */
export function formatDecimalAmount(amount: Cents | number): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Inverse of parseDecimalQuantity: 2500 → "2.5", 1000 → "1". */
export function formatDecimalQuantity(milli: number): string {
  const frac = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return frac ? `${Math.trunc(milli / 1000)}.${frac}` : String(Math.trunc(milli / 1000));
}
