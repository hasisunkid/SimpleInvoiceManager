import { Type, type Static } from '@sinclair/typebox';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from '@sim/domain';

/** Shared TypeBox schemas: validation, TypeScript types and OpenAPI in one place (AR-07). */

export const LanguageSchema = Type.Union(
  [Type.Literal('de'), Type.Literal('pl'), Type.Literal('en')],
  { description: 'UI / document language' },
);

export const RoleSchema = Type.Union([Type.Literal('USER'), Type.Literal('ADMIN')]);

export const UsernameSchema = Type.String({
  pattern: USERNAME_PATTERN,
  description: 'Lowercase letters, digits, ".", "_" or "-"; 3–32 characters',
});

export const NewPasswordSchema = Type.String({
  minLength: MIN_PASSWORD_LENGTH,
  maxLength: MAX_PASSWORD_LENGTH,
});

export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: 128 });

export const PublicUserSchema = Type.Object({
  id: Type.Integer(),
  username: Type.String(),
  displayName: Type.String(),
  role: RoleSchema,
  uiLanguage: Type.Union([LanguageSchema, Type.Null()]),
  active: Type.Boolean(),
  mustChangePassword: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

/**
 * Every error response has a stable machine-readable `error` code; the frontend shows a
 * translated text for it (NFR-UX-03) and uses `message` only as a fallback.
 */
export const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  retryAfterSeconds: Type.Optional(Type.Integer()),
  /** Per-field problem codes for form validation, e.g. { iban: 'INVALID_IBAN' }. */
  fields: Type.Optional(Type.Record(Type.String(), Type.String())),
  /** What is missing before an invoice can be finalized (INVOICE_INCOMPLETE, FR-INV-07). */
  problems: Type.Optional(Type.Array(Type.String())),
});
export type ErrorBody = Static<typeof ErrorSchema>;

export const IdParamsSchema = Type.Object({ id: Type.Integer({ minimum: 1 }) });

export function errorResponses<const T extends readonly number[]>(...codes: T) {
  return Object.fromEntries(codes.map((code) => [code, ErrorSchema])) as Record<
    T[number],
    typeof ErrorSchema
  >;
}
