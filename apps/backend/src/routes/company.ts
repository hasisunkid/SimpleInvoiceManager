import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import {
  missingForFinalize,
  normalizeBic,
  normalizeIban,
  normalizeVatId,
  validateCompany,
  type CompanyProfile,
} from '@sim/domain';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import { loadCompany, saveCompany } from '../company/repository.js';
import { loadNumbering } from '../numbering/repository.js';
import { errorResponses } from '../schemas.js';

const str = (maxLength: number) => Type.String({ maxLength });
const Texts = Type.Object({ de: str(2000), pl: str(2000), en: str(2000) });

export const CompanySchema = Type.Object({
  name: str(200),
  ownerName: str(200),
  street: str(200),
  zip: str(16),
  city: str(120),
  countryCode: Type.String({ minLength: 2, maxLength: 2 }),
  phone: str(50),
  mobile: str(50),
  email: str(254),
  website: str(254),
  taxNumber: str(32),
  vatId: str(24),
  bankName: str(120),
  iban: str(42),
  bic: str(14),
  accountHolder: str(200),
  taxMode: Type.Union([Type.Literal('REGULAR'), Type.Literal('SMALL_BUSINESS_19')]),
  defaultPaymentTermDays: Type.Integer({ minimum: 0, maximum: 365 }),
  defaultVatRate: Type.Union([Type.Literal(19), Type.Literal(7), Type.Literal(0)]),
  signatureName: str(200),
  introTexts: Texts,
  closingTexts: Texts,
});

const CompanyResponse = Type.Object({
  profile: CompanySchema,
  readiness: Type.Object({
    /** What is still missing before invoices can be finalized (FR-COMP-04, FR-NUM-01). */
    missing: Type.Array(Type.String()),
  }),
  updatedAt: Type.String({ format: 'date-time' }),
});

/** Trims and canonicalizes identifiers so they are stored in one form. */
function normalize(input: Static<typeof CompanySchema>): CompanyProfile {
  const trimTexts = (texts: Static<typeof Texts>) => ({
    de: texts.de.trim(),
    pl: texts.pl.trim(),
    en: texts.en.trim(),
  });
  return {
    ...input,
    name: input.name.trim(),
    ownerName: input.ownerName.trim(),
    street: input.street.trim(),
    zip: input.zip.trim(),
    city: input.city.trim(),
    countryCode: input.countryCode.trim().toUpperCase(),
    phone: input.phone.trim(),
    mobile: input.mobile.trim(),
    email: input.email.trim(),
    website: input.website.trim(),
    taxNumber: input.taxNumber.trim(),
    vatId: normalizeVatId(input.vatId),
    bankName: input.bankName.trim(),
    iban: normalizeIban(input.iban),
    bic: normalizeBic(input.bic),
    accountHolder: input.accountHolder.trim(),
    signatureName: input.signatureName.trim(),
    introTexts: trimTexts(input.introTexts),
    closingTexts: trimTexts(input.closingTexts),
  };
}

/** FR-COMP-01..04: one company profile, readable and editable by every user. */
export const companyRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  async function response() {
    const [{ profile, updatedAt }, numbering] = await Promise.all([
      loadCompany(db),
      loadNumbering(db),
    ]);
    const missing: string[] = missingForFinalize(profile);
    if (!numbering.configured) missing.push('numbering');
    return { profile, readiness: { missing }, updatedAt: updatedAt.toISOString() };
  }

  app.get(
    '/company',
    {
      schema: {
        summary: 'Company profile (invoice header and footer)',
        tags: ['company'],
        response: { 200: CompanyResponse, ...errorResponses(401, 403) },
      },
    },
    response,
  );

  app.put(
    '/company',
    {
      schema: {
        summary: 'Update the company profile',
        tags: ['company'],
        body: CompanySchema,
        response: { 200: CompanyResponse, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const profile = normalize(request.body);
      const problems = validateCompany(profile);
      const first = Object.values(problems)[0];
      if (first) {
        return reply.code(400).send({
          error: first,
          message: 'Some fields are invalid',
          fields: problems as Record<string, string>,
        });
      }
      await saveCompany(db, profile, currentAuth(request).user.id);
      return response();
    },
  );
};
