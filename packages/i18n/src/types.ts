import type { de } from './de.js';

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape of a complete translation – derived from German, the reference language. */
export type Messages = Widen<typeof de>;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every dotted message key, e.g. "pdf.invoice" – lets `translate()` reject typos at compile time. */
export type MessageKey = Leaves<typeof de>;
