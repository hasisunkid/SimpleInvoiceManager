import type { CustomerType } from './customer.js';
import type { PositionType, UnitCode } from './units.js';

/**
 * Similarity rules for the MCP lookup (decision D8, FR-MCP-05, FR-MCP-08): an AI assistant
 * should reuse an existing customer or catalogue entry when a *similar* one exists, and only
 * create a new one otherwise. Pure functions – the server loads candidates and asks these.
 */

/** Letters without a Unicode decomposition that NFD cannot strip. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ł: 'l',
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  đ: 'd',
};

/**
 * Lowercase, without accents ("Góralewicz" → "goralewicz", "Łódź" → "lodz", "ß" → "ss") and
 * with every non-alphanumeric run collapsed to one space.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[łßæøđ]/g, (ch) => SPECIAL_LETTERS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Legal forms and filler words ignored when comparing company names (DE / PL / EN), e.g.
 * "Omicronservice GmbH" = "omicronservice", "Kowalski Sp. z o.o." = "kowalski".
 */
const LEGAL_FORM_WORDS = new Set([
  'gmbh',
  'mbh',
  'ug',
  'haftungsbeschrankt',
  'ag',
  'kg',
  'kgaa',
  'ohg',
  'gbr',
  'ev',
  'eg',
  'ek',
  'se',
  'co',
  'und',
  'sp',
  'z',
  'o',
  'oo',
  'zoo',
  'spolka',
  'sa',
  'sc',
  'ltd',
  'limited',
  'inc',
  'llc',
  'plc',
  'and',
]);

/** Salutations and titles ignored in person names ("Herr Karaca" = "Karaca"). */
const SALUTATIONS = new Set([
  'herr',
  'frau',
  'hr',
  'fr',
  'dr',
  'prof',
  'pan',
  'pani',
  'mr',
  'mrs',
  'ms',
]);

export function normalizePersonName(name: string): string {
  return normalizeText(name)
    .split(' ')
    .filter((word) => word && !SALUTATIONS.has(word))
    .join(' ');
}

export function normalizeCompanyName(name: string): string {
  return normalizeText(name)
    .split(' ')
    .filter((word) => word && !LEGAL_FORM_WORDS.has(word))
    .join(' ');
}

/** Sørensen–Dice coefficient over character bigrams (0 … 1); tolerant of small typos. */
export function bigramSimilarity(a: string, b: string): number {
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  if (x === y) return x.length > 0 ? 1 : 0;
  if (x.length < 2 || y.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const gram = x.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const gram = y.slice(i, i + 2);
    const n = counts.get(gram) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(gram, n - 1);
    }
  }
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

/** Two words match when equal, one is a prefix of the other (≥ 4 letters) or nearly equal. */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  return short.length >= 5 && bigramSimilarity(a, b) >= 0.8;
}

/** Dice coefficient over word sets, with fuzzy word matching (0 … 1). */
function wordSetSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const unused = [...b];
  let matched = 0;
  for (const word of a) {
    const index = unused.findIndex((other) => wordsMatch(word, other));
    if (index !== -1) {
      matched++;
      unused.splice(index, 1);
    }
  }
  return (2 * matched) / (a.length + b.length);
}

/** Score when every word of the shorter name occurs in the longer one ("Góralewicz"). */
const CONTAINED_NAME_SCORE = 0.85;

/**
 * Names are compared word by word (fuzzy, any order). The whole-name character similarity only
 * counts when it is very high (≥ 0.9, e.g. "Omicron Service" = "Omicronservice"): long names
 * that share most words – "E2E Kunde Mobil" vs "KI Kunde Mobil" – are different customers.
 */
function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wa = a.split(' ');
  const wb = b.split(' ');
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const contained =
    shorter.length < longer.length &&
    shorter.every((w) => w.length >= 4 && longer.some((other) => wordsMatch(w, other)));
  const whole = bigramSimilarity(a, b);
  return Math.max(
    wordSetSimilarity(wa, wb),
    contained ? CONTAINED_NAME_SCORE : 0,
    whole >= 0.9 ? whole : 0,
  );
}

// ---------------------------------------------------------------- customers (FR-MCP-05)

export interface CustomerLookup {
  readonly type?: CustomerType;
  /** Company name (business) or the person's name (private) – whatever the user said. */
  readonly name: string;
  readonly contactPerson?: string;
  readonly zip?: string;
  readonly city?: string;
}

export interface CustomerCandidate {
  readonly id: number;
  readonly type: CustomerType;
  readonly companyName: string;
  readonly contactPerson: string;
  readonly zip: string;
  readonly city: string;
  readonly archived: boolean;
}

/** Minimum score for "similar" – below it a new customer is created. */
export const CUSTOMER_MATCH_THRESHOLD = 0.8;

/**
 * How similar a candidate is to what the user asked for (0 … 1). The name is compared with
 * the company name (legal form ignored) and with the contact person; a matching ZIP or city
 * raises the score, a different ZIP or city lowers it below the threshold ("same name with same ZIP/city counts as a
 * match", FR-MCP-05).
 */
export function customerSimilarity(lookup: CustomerLookup, candidate: CustomerCandidate): number {
  const wanted = normalizeCompanyName(lookup.name);
  const wantedPerson = normalizePersonName(lookup.contactPerson ?? '');
  const company = normalizeCompanyName(candidate.companyName);
  const person = normalizePersonName(candidate.contactPerson);
  let score = Math.max(
    nameSimilarity(wanted, company),
    nameSimilarity(wanted, person),
    // "Karaca" for the business "Omicronservice" whose contact person is Karaca.
    wantedPerson ? Math.min(nameSimilarity(wantedPerson, person), 0.85) : 0,
  );
  if (score === 0) return 0;
  const zip = (lookup.zip ?? '').trim();
  const city = normalizeText(lookup.city ?? '');
  if (zip && candidate.zip.trim()) score += zip === candidate.zip.trim() ? 0.05 : -0.25;
  else if (city && candidate.city) score += city === normalizeText(candidate.city) ? 0.05 : -0.25;
  return Math.max(0, Math.min(1, score));
}

export interface Ranked<T> {
  readonly candidate: T;
  readonly score: number;
}

/** Candidates at or above `threshold`, best first (ties: lower id = older entry first). */
export function rankCandidates<T extends { readonly id: number }>(
  candidates: readonly T[],
  score: (candidate: T) => number,
  threshold: number,
): Ranked<T>[] {
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);
}

// ---------------------------------------------------------------- catalogue (FR-MCP-08)

/** Words that say nothing about *what* was done or delivered (units, fillers; DE/PL/EN). */
const CATALOG_STOP_WORDS = new Set([
  'und',
  'oder',
  'der',
  'die',
  'das',
  'fur',
  'mit',
  'von',
  'zum',
  'zur',
  'inkl',
  'pro',
  'je',
  'pauschal',
  'pauschale',
  'stunde',
  'stunden',
  'std',
  'stk',
  'stuck',
  'the',
  'and',
  'for',
  'with',
  'per',
  'of',
  'lump',
  'sum',
  'hour',
  'hours',
  'piece',
  'pieces',
  'pcs',
  'i',
  'oraz',
  'dla',
  'za',
  'ryczalt',
  'godzina',
  'godziny',
  'godz',
  'szt',
  'h',
  'm',
  'm2',
  'm3',
  'qm',
  'kg',
]);

export function catalogWords(text: string): string[] {
  return [
    ...new Set(
      normalizeText(text)
        .split(' ')
        .filter((word) => word.length >= 2 && !CATALOG_STOP_WORDS.has(word) && !/^\d+$/.test(word)),
    ),
  ];
}

export interface CatalogLookup {
  readonly type: PositionType;
  readonly title: string;
  readonly unitCode?: UnitCode;
}

export interface CatalogCandidate {
  readonly id: number;
  readonly type: PositionType;
  readonly title: string;
  readonly description: string;
  readonly unitCode: UnitCode;
}

export const CATALOG_MATCH_THRESHOLD = 0.6;

/**
 * Similarity of a catalogue entry to a position the user described (0 … 1): same type
 * required (work ≠ material), compatible unit (equal, or none stated), and the meaningful
 * words of the title – compared with the entry's title, or title plus description.
 */
export function catalogSimilarity(lookup: CatalogLookup, candidate: CatalogCandidate): number {
  if (lookup.type !== candidate.type) return 0;
  if (lookup.unitCode && lookup.unitCode !== candidate.unitCode) return 0;
  const wanted = catalogWords(lookup.title);
  if (wanted.length === 0) return 0;
  const title = catalogWords(candidate.title);
  const full = catalogWords(`${candidate.title} ${candidate.description}`);
  return Math.max(wordSetSimilarity(wanted, title), 0.9 * wordSetSimilarity(wanted, full));
}

/** FR-CAT-03: how a catalogue entry is written into an invoice position. */
export function catalogPositionText(item: { title: string; description: string }): string {
  return item.description.trim() ? `${item.title}\n${item.description}` : item.title;
}
