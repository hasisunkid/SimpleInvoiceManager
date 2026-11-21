import type { DocumentLanguage } from './money.js';

/** ISO calendar date "YYYY-MM-DD" without time zone. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): value is IsoDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function parts(date: IsoDate): [string, string, string] {
  if (!isIsoDate(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const [y, m, d] = date.split('-') as [string, string, string];
  return [y, m, d];
}

/** Adds whole days to an ISO date (used for due date = invoice date + payment term). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date).map(Number) as [number, number, number];
  const result = new Date(Date.UTC(y, m - 1, d + days));
  return result.toISOString().slice(0, 10);
}

/** Formats a date in the document language (FR-I18N-03): de/pl "22.05.2024", en "22/05/2024". */
export function formatDate(date: IsoDate, language: DocumentLanguage): string {
  const [y, m, d] = parts(date);
  return language === 'en' ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
}

/**
 * Compact service period (FR-INV-01) as usual in German/Polish typography:
 * same month "13.–17.05.2024", same year "28.05.–03.06.2024", otherwise both dates in full.
 * English: "13–17/05/2024", "28/05–03/06/2024".
 */
export function formatDateRange(from: IsoDate, to: IsoDate, language: DocumentLanguage): string {
  if (from === to) return formatDate(from, language);
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const sep = language === 'en' ? '/' : '.';
  const end = formatDate(to, language);
  if (fy !== ty) return `${formatDate(from, language)} – ${end}`;
  if (fm !== tm) return `${fd}${sep}${fm}${language === 'en' ? '' : '.'}–${end}`;
  return `${fd}${language === 'en' ? '' : '.'}–${td}${sep}${tm}${sep}${ty}`;
}
