import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { normalizeUsername } from '@sim/domain';
import type { Db } from '../db.js';
import { hashPassword } from '../auth/passwords.js';
import type { SessionStore } from '../auth/sessions.js';
import {
  findUserById,
  insertUser,
  isDuplicateKeyError,
  listUsers,
  lockActiveAdminIds,
  toPublicUser,
  updateUser,
} from '../users/repository.js';
import {
  DisplayNameSchema,
  IdParamsSchema,
  LanguageSchema,
  NewPasswordSchema,
  PublicUserSchema,
  RoleSchema,
  UsernameSchema,
  errorResponses,
} from '../schemas.js';

class LastAdminError extends Error {}

/** FR-AUTH-04: user management, admin only. */
export const userRoutes: FastifyPluginAsyncTypebox<{ db: Db; sessions: SessionStore }> = async (
  app,
  { db, sessions },
) => {
  const notFound = { error: 'USER_NOT_FOUND', message: 'User not found' } as const;

  app.get(
    '/users',
    {
      config: { admin: true },
      schema: {
        summary: 'List users',
        tags: ['users'],
        response: { 200: Type.Array(PublicUserSchema), ...errorResponses(401, 403) },
      },
    },
    async () => (await listUsers(db)).map(toPublicUser),
  );

  app.get(
    '/users/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Get a user',
        tags: ['users'],
        params: IdParamsSchema,
        response: { 200: PublicUserSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (request, reply) => {
      const user = await findUserById(db, request.params.id);
      return user ? toPublicUser(user) : reply.code(404).send(notFound);
    },
  );

  app.post(
    '/users',
    {
      config: { admin: true },
      schema: {
        summary: 'Create a user (must change the password at first login)',
        tags: ['users'],
        body: Type.Object({
          username: UsernameSchema,
          displayName: DisplayNameSchema,
          role: RoleSchema,
          password: NewPasswordSchema,
          uiLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
        }),
        response: { 201: PublicUserSchema, ...errorResponses(400, 401, 403, 409) },
      },
      // Accept "Anna" and store "anna" – usernames are case-insensitive.
      preValidation: async (request) => {
        const body = request.body as { username?: unknown };
        if (typeof body?.username === 'string') body.username = normalizeUsername(body.username);
      },
    },
    async (request, reply) => {
      const { username, displayName, role, password, uiLanguage } = request.body;
      try {
        const id = await insertUser(db, {
          username,
          displayName: displayName.trim(),
          passwordHash: await hashPassword(password),
          role,
          uiLanguage: uiLanguage ?? null,
          mustChangePassword: true,
        });
        return reply.code(201).send(toPublicUser((await findUserById(db, id))!));
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          return reply
            .code(409)
            .send({ error: 'USERNAME_TAKEN', message: 'This username is already taken' });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/users/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Edit, (de)activate or change the role of a user',
        tags: ['users'],
        params: IdParamsSchema,
        body: Type.Object(
          {
            displayName: Type.Optional(DisplayNameSchema),
            role: Type.Optional(RoleSchema),
            active: Type.Optional(Type.Boolean()),
            uiLanguage: Type.Optional(Type.Union([LanguageSchema, Type.Null()])),
          },
          { minProperties: 1 },
        ),
        response: { 200: PublicUserSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const changes = request.body;
      try {
        const found = await db.transaction(async (trx) => {
          const admins = await lockActiveAdminIds(trx);
          const user = await findUserById(trx, id);
          if (!user) return false;
          const losesAdmin =
            admins.includes(id) &&
            ((changes.role !== undefined && changes.role !== 'ADMIN') || changes.active === false);
          if (losesAdmin && admins.length <= 1) throw new LastAdminError();
          await updateUser(trx, id, {
            ...changes,
            ...(changes.displayName !== undefined
              ? { displayName: changes.displayName.trim() }
              : {}),
          });
          return true;
        });
        if (!found) return reply.code(404).send(notFound);
      } catch (err) {
        if (err instanceof LastAdminError) {
          return reply.code(409).send({
            error: 'LAST_ADMIN',
            message: 'The last active administrator cannot be deactivated or demoted',
          });
        }
        throw err;
      }
      // A deactivated user is logged out everywhere immediately.
      if (changes.active === false) await sessions.deleteForUser(id);
      return toPublicUser((await findUserById(db, id))!);
    },
  );

  app.put(
    '/users/:id/password',
    {
      config: { admin: true },
      schema: {
        summary: 'Reset a password (user must change it at next login)',
        tags: ['users'],
        params: IdParamsSchema,
        body: Type.Object({ newPassword: NewPasswordSchema }),
        response: { 200: PublicUserSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await findUserById(db, id))) return reply.code(404).send(notFound);
      await updateUser(db, id, {
        passwordHash: await hashPassword(request.body.newPassword),
        mustChangePassword: true,
      });
      await sessions.deleteForUser(id);
      return toPublicUser((await findUserById(db, id))!);
    },
  );
};
