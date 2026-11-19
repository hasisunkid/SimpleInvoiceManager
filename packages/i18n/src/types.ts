import type { de } from './de.js';

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape of a complete translation – derived from German, the reference language. */
export type Messages = Widen<typeof de>;
