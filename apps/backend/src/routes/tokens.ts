import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Db } from '../db.js';
import { currentAuth } from '../auth/guard.js';
import { createToken, findToken, listTokens, revokeToken } from '../mcp/tokens.js';
import { IdParamsSchema, errorResponses } from '../schemas.js';

export const ApiTokenSchema = Type.Object({
  id: Type.Integer(),
  userId: Type.Integer(),
  userName: Type.String(),
  name: Type.String(),
  prefix: Type.String(),
  scopes: Type.Array(Type.String()),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastUsedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  active: Type.Boolean(),
});

const TokenList = Type.Object({
  /** FR-MCP-12: whether the MCP server is switched on (app option `mcp_enabled`). */
  mcpEnabled: Type.Boolean(),
  items: Type.Array(ApiTokenSchema),
});

const notFound = { error: 'TOKEN_NOT_FOUND', message: 'Token not found' } as const;

/**
 * FR-MCP-03: personal API tokens for AI assistants. Every user manages their own tokens in
 * *Profil*; administrators see and can revoke all tokens.
 */
export const tokenRoutes: FastifyPluginAsyncTypebox<{ db: Db; mcpEnabled: boolean }> = async (
  app,
  { db, mcpEnabled },
) => {
  app.get(
    '/me/tokens',
    {
      schema: {
        summary: 'Own API tokens for AI assistants (MCP)',
        tags: ['me'],
        response: { 200: TokenList, ...errorResponses(401, 403) },
      },
    },
    async (request) => ({
      mcpEnabled,
      items: await listTokens(db, currentAuth(request).user.id),
    }),
  );

  app.post(
    '/me/tokens',
    {
      schema: {
        summary: 'Create an API token – the token is returned only in this response',
        tags: ['me'],
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          /** Optional expiry; null = valid until revoked. */
          expiresInDays: Type.Union([Type.Integer({ minimum: 1, maximum: 3650 }), Type.Null()]),
        }),
        response: {
          201: Type.Object({ token: Type.String(), item: ApiTokenSchema }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) {
        return reply.code(400).send({ error: 'TOKEN_NAME_REQUIRED', message: 'Name is required' });
      }
      const { expiresInDays } = request.body;
      const expiresAt =
        expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000);
      const { user } = currentAuth(request);
      const { id, token } = await createToken(db, user.id, name, expiresAt);
      request.log.info({ tokenId: id, userId: user.id }, 'api token created');
      return reply.code(201).send({ token, item: (await findToken(db, id))! });
    },
  );

  app.delete(
    '/me/tokens/:id',
    {
      schema: {
        summary: 'Revoke one of the own API tokens',
        tags: ['me'],
        params: IdParamsSchema,
        response: { 204: Type.Null(), ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const token = await findToken(db, request.params.id);
      // Another user's token is reported as missing – its existence is not revealed.
      if (!token || token.userId !== currentAuth(request).user.id) {
        return reply.code(404).send(notFound);
      }
      await revokeToken(db, token.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/admin/tokens',
    {
      config: { admin: true },
      schema: {
        summary: 'All API tokens of all users (admin)',
        tags: ['admin'],
        response: { 200: TokenList, ...errorResponses(401, 403) },
      },
    },
    async () => ({ mcpEnabled, items: await listTokens(db) }),
  );

  app.delete(
    '/admin/tokens/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Revoke any API token (admin)',
        tags: ['admin'],
        params: IdParamsSchema,
        response: { 204: Type.Null(), ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const token = await findToken(db, request.params.id);
      if (!token) return reply.code(404).send(notFound);
      await revokeToken(db, token.id);
      request.log.info(
        { tokenId: token.id, by: currentAuth(request).user.id },
        'api token revoked',
      );
      return reply.code(204).send(null);
    },
  );
};
