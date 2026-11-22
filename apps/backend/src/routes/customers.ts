import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import { normalizeVatId, validateCustomer, type CustomerData } from '@sim/domain';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import {
  deleteCustomer,
  findCustomer,
  insertCustomer,
  isReferencedError,
  searchCustomers,
  setCustomerArchived,
  updateCustomer,
  markCustomerReviewed,
} from '../customers/repository.js';
import { IdParamsSchema, LanguageSchema, errorResponses } from '../schemas.js';

const str = (maxLength: number) => Type.String({ maxLength });

export const CustomerTypeSchema = Type.Union([Type.Literal('BUSINESS'), Type.Literal('PRIVATE')]);

/** Only type and name are required, so the editor can quick-create customers (FR-CUST-05). */
const CustomerBody = Type.Object({
  type: CustomerTypeSchema,
  companyName: Type.Optional(str(200)),
  contactPerson: Type.Optional(str(200)),
  street: Type.Optional(str(200)),
  zip: Type.Optional(str(16)),
  city: Type.Optional(str(120)),
  countryCode: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
  email: Type.Optional(str(254)),
  phone: Type.Optional(str(50)),
  vatId: Type.Optional(str(24)),
  invoiceLanguage: Type.Optional(LanguageSchema),
  notes: Type.Optional(str(4000)),
});

export const CustomerSchema = Type.Object({
  id: Type.Integer(),
  type: CustomerTypeSchema,
  companyName: Type.String(),
  contactPerson: Type.String(),
  displayName: Type.String(),
  street: Type.String(),
  zip: Type.String(),
  city: Type.String(),
  countryCode: Type.String(),
  email: Type.String(),
  phone: Type.String(),
  vatId: Type.String(),
  invoiceLanguage: LanguageSchema,
  notes: Type.String(),
  archived: Type.Boolean(),
  /** FR-MCP-10: badge "Von KI erstellt". */
  aiCreated: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

function normalize(body: Static<typeof CustomerBody>): CustomerData {
  return {
    type: body.type,
    companyName: (body.companyName ?? '').trim(),
    contactPerson: (body.contactPerson ?? '').trim(),
    street: (body.street ?? '').trim(),
    zip: (body.zip ?? '').trim(),
    city: (body.city ?? '').trim(),
    countryCode: (body.countryCode ?? 'DE').trim().toUpperCase(),
    email: (body.email ?? '').trim(),
    phone: (body.phone ?? '').trim(),
    vatId: normalizeVatId(body.vatId ?? ''),
    invoiceLanguage: body.invoiceLanguage ?? 'de',
    notes: (body.notes ?? '').trim(),
  };
}

/** FR-CUST-01..05: customers, available to every user. */
export const customerRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  const notFound = { error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } as const;

  function invalid(data: CustomerData) {
    const problems = validateCustomer(data);
    const first = Object.values(problems)[0];
    return first
      ? {
          error: first,
          message: 'Some fields are invalid',
          fields: problems as Record<string, string>,
        }
      : null;
  }

  app.get(
    '/customers',
    {
      schema: {
        summary: 'Search customers (name, company, contact person, city)',
        tags: ['customers'],
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 100 })),
          includeArchived: Type.Optional(Type.Boolean({ default: false })),
          /** FR-MCP-10 filter "Von KI erstellt". */
          aiCreated: Type.Optional(Type.Boolean({ default: false })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
        }),
        response: {
          200: Type.Object({ items: Type.Array(CustomerSchema), total: Type.Integer() }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (request) => {
      const { q, includeArchived, aiCreated, limit = 50, offset = 0 } = request.query;
      return searchCustomers(db, {
        limit,
        offset,
        ...(aiCreated !== undefined ? { aiCreated } : {}),
        ...(q !== undefined ? { q } : {}),
        ...(includeArchived !== undefined ? { includeArchived } : {}),
      });
    },
  );

  app.get(
    '/customers/:id',
    {
      schema: {
        summary: 'Get a customer',
        tags: ['customers'],
        params: IdParamsSchema,
        response: { 200: CustomerSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) =>
      (await findCustomer(db, request.params.id)) ?? reply.code(404).send(notFound),
  );

  app.post(
    '/customers',
    {
      schema: {
        summary: 'Create a customer (type and name are enough – FR-CUST-05)',
        tags: ['customers'],
        body: CustomerBody,
        response: { 201: CustomerSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const data = normalize(request.body);
      const problem = invalid(data);
      if (problem) return reply.code(400).send(problem);
      const id = await insertCustomer(db, data, currentAuth(request).user.id);
      return reply.code(201).send((await findCustomer(db, id))!);
    },
  );

  app.put(
    '/customers/:id',
    {
      schema: {
        summary: 'Update a customer',
        tags: ['customers'],
        params: IdParamsSchema,
        body: CustomerBody,
        response: { 200: CustomerSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const data = normalize(request.body);
      const problem = invalid(data);
      if (problem) return reply.code(400).send(problem);
      const found = await updateCustomer(db, request.params.id, data, currentAuth(request).user.id);
      if (!found) return reply.code(404).send(notFound);
      return (await findCustomer(db, request.params.id))!;
    },
  );

  app.post(
    '/customers/:id/reviewed',
    {
      schema: {
        summary: 'Confirm an AI-created customer ("Geprüft", FR-MCP-10)',
        tags: ['customers'],
        params: IdParamsSchema,
        response: { 200: CustomerSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await markCustomerReviewed(db, id, currentAuth(request).user.id))) {
        return reply.code(404).send(notFound);
      }
      return (await findCustomer(db, id))!;
    },
  );

  app.put(
    '/customers/:id/archived',
    {
      schema: {
        summary: 'Archive or restore a customer (FR-CUST-04)',
        tags: ['customers'],
        params: IdParamsSchema,
        body: Type.Object({ archived: Type.Boolean() }),
        response: { 200: CustomerSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const found = await setCustomerArchived(
        db,
        id,
        request.body.archived,
        currentAuth(request).user.id,
      );
      if (!found) return reply.code(404).send(notFound);
      return (await findCustomer(db, id))!;
    },
  );

  app.delete(
    '/customers/:id',
    {
      schema: {
        summary: 'Delete a customer without invoices (otherwise archive it, FR-CUST-04)',
        tags: ['customers'],
        params: IdParamsSchema,
        response: { 204: Type.Null(), ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      try {
        if (!(await deleteCustomer(db, request.params.id))) return reply.code(404).send(notFound);
      } catch (err) {
        // Invoices reference customers with ON DELETE RESTRICT (M4): the DB has the last word.
        if (isReferencedError(err)) {
          return reply.code(409).send({
            error: 'CUSTOMER_HAS_INVOICES',
            message: 'Customers with invoices can only be archived',
          });
        }
        throw err;
      }
      return reply.code(204).send(null);
    },
  );
};
