/**
 * Bank and tax identifiers (FR-COMP-01, FR-COMP-04).
 */

/** Removes spaces and uppercases: "de89 3704 0044 0532 0130 00" → "DE89370400440532013000". */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** Expected IBAN lengths for countries likely to appear; others only need 15–34 characters. */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  DE: 22,
  AT: 20,
  CH: 21,
  PL: 28,
  NL: 18,
  BE: 16,
  FR: 27,
  LU: 20,
  DK: 18,
  CZ: 24,
  IT: 27,
  ES: 24,
  GB: 22,
};

/** ISO 13616 check: structure, country length and mod-97 checksum. */
export function isValidIban(iban: string): boolean {
  const value = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const expected = IBAN_LENGTHS[value.slice(0, 2)];
  if (expected !== undefined && value.length !== expected) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Groups of four for display and PDF: "DE89 3704 0044 0532 0130 00". */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

export function normalizeBic(bic: string): string {
  return bic.replace(/\s+/g, '').toUpperCase();
}

/** ISO 9362: 4 bank, 2 country, 2 location, optional 3 branch characters. */
export function isValidBic(bic: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(bic));
}

export function normalizeVatId(vatId: string): string {
  return vatId.replace(/[\s.-]+/g, '').toUpperCase();
}

/** EU VAT ID: country prefix + 2–12 characters; German ones are "DE" + 9 digits. */
export function isValidVatId(vatId: string): boolean {
  const value = normalizeVatId(vatId);
  if (value.startsWith('DE')) return /^DE\d{9}$/.test(value);
  return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(value);
}

/**
 * German Steuernummer as printed by the Finanzamt, e.g. "12/345/67890" or "123/456/78901"
 * (10–11 digits) or the 13-digit federal format. Only digits, "/", " " and "-" are allowed.
 */
export function isValidTaxNumber(taxNumber: string): boolean {
  const value = taxNumber.trim();
  if (!/^[\d/ -]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 10 && digits <= 13;
}

/**
 * Plausible e-mail address: local part, "@", domain with at least one dot. The domain is
 * matched label by label ("[^.]+(\.[^.]+)+"), so the pattern cannot backtrack (ReDoS-safe).
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL.test(email);
}
