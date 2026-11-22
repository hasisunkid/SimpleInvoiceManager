import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, type Static } from '@sinclair/typebox';
import {
  MAX_UNIT_PRICE_CENTS,
  UNIT_CODES,
  validateCatalogItem,
  type CatalogItemData,
} from '@sim/domain';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import {
  deleteCatalogItem,
  findCatalogItem,
  insertCatalogItem,
  searchCatalog,
  updateCatalogItem,
  markCatalogItemReviewed,
} from '../catalog/repository.js';
import { IdParamsSchema, errorResponses } from '../schemas.js';

export const PositionTypeSchema = Type.Union([Type.Literal('WORK'), Type.Literal('MATERIAL')]);
export const UnitCodeSchema = Type.Union(UNIT_CODES.map((code) => Type.Literal(code)));
export const VatRateSchema = Type.Union([Type.Literal(19), Type.Literal(7), Type.Literal(0)]);

const CatalogBody = Type.Object({
  type: PositionTypeSchema,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.String({ maxLength: 4000 }),
  unitCode: UnitCodeSchema,
  unitPriceCents: Type.Integer({ minimum: 0, maximum: MAX_UNIT_PRICE_CENTS }),
  vatRate: VatRateSchema,
  active: Type.Boolean({ default: true }),
});

const CatalogItemSchema = Type.Composite([
  Type.Object({ id: Type.Integer() }),
  CatalogBody,
  Type.Object({
    /** FR-MCP-10: badge "Von KI erstellt". */
    aiCreated: Type.Boolean(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  }),
]);

function normalize(body: Static<typeof CatalogBody>): CatalogItemData {
  return { ...body, title: body.title.trim(), description: body.description.trim() };
}

/** FR-CAT-01..04: reusable positions, available to every user. */
export const catalogRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  const notFound = {
    error: 'CATALOG_ITEM_NOT_FOUND',
    message: 'Catalogue item not found',
  } as const;

  function invalid(item: CatalogItemData) {
    const problems = validateCatalogItem(item);
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
    '/catalog',
    {
      schema: {
        summary: 'Search the position catalogue (FR-CAT-03)',
        tags: ['catalog'],
        querystring: Type.Object({
          q: Type.Optional(Type.String({ maxLength: 100 })),
          type: Type.Optional(PositionTypeSchema),
          includeInactive: Type.Optional(Type.Boolean({ default: false })),
          /** FR-MCP-10 filter "Von KI erstellt". */
          aiCreated: Type.Optional(Type.Boolean({ default: false })),
        }),
        response: { 200: Type.Array(CatalogItemSchema), ...errorResponses(400, 401, 403) },
      },
    },
    async (request) => {
      const { q, type, includeInactive, aiCreated } = request.query;
      return searchCatalog(db, {
        ...(aiCreated !== undefined ? { aiCreated } : {}),
        ...(q !== undefined ? { q } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(includeInactive !== undefined ? { includeInactive } : {}),
      });
    },
  );

  app.get(
    '/catalog/:id',
    {
      schema: {
        summary: 'Get a catalogue item',
        tags: ['catalog'],
        params: IdParamsSchema,
        response: { 200: CatalogItemSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) =>
      (await findCatalogItem(db, request.params.id)) ?? reply.code(404).send(notFound),
  );

  app.post(
    '/catalog',
    {
      schema: {
        summary: 'Create a catalogue item (also "save as template" from an invoice, FR-CAT-04)',
        tags: ['catalog'],
        body: CatalogBody,
        response: { 201: CatalogItemSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const item = normalize(request.body);
      const problem = invalid(item);
      if (problem) return reply.code(400).send(problem);
      const id = await insertCatalogItem(db, item, currentAuth(request).user.id);
      return reply.code(201).send((await findCatalogItem(db, id))!);
    },
  );

  app.post(
    '/catalog/:id/reviewed',
    {
      schema: {
        summary: 'Confirm an AI-created catalogue item ("Geprüft", FR-MCP-10)',
        tags: ['catalog'],
        params: IdParamsSchema,
        response: { 200: CatalogItemSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await markCatalogItemReviewed(db, id, currentAuth(request).user.id))) {
        return reply.code(404).send(notFound);
      }
      return (await findCatalogItem(db, id))!;
    },
  );

  app.put(
    '/catalog/:id',
    {
      schema: {
        summary: 'Update a catalogue item (existing invoices are not affected)',
        tags: ['catalog'],
        params: IdParamsSchema,
        body: CatalogBody,
        response: { 200: CatalogItemSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const item = normalize(request.body);
      const problem = invalid(item);
      if (problem) return reply.code(400).send(problem);
      if (!(await updateCatalogItem(db, request.params.id, item, currentAuth(request).user.id))) {
        return reply.code(404).send(notFound);
      }
      return (await findCatalogItem(db, request.params.id))!;
    },
  );

  app.delete(
    '/catalog/:id',
    {
      schema: {
        summary: 'Delete a catalogue item',
        tags: ['catalog'],
        params: IdParamsSchema,
        response: { 204: Type.Null(), ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      if (!(await deleteCatalogItem(db, request.params.id))) return reply.code(404).send(notFound);
      return reply.code(204).send(null);
    },
  );
};
