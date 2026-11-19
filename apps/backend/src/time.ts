import type { IsoDate } from '@sim/domain';

/**
 * The business operates in Germany: "today" (default invoice date, year of an invoice number)
 * is the calendar date in Europe/Berlin, independent of the server's time zone (usually UTC).
 */
export const BUSINESS_TIME_ZONE = 'Europe/Berlin';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function businessToday(now: Date = new Date()): IsoDate {
  return formatter.format(now);
}

export function businessYear(now: Date = new Date()): number {
  return Number(businessToday(now).slice(0, 4));
}
