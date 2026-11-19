import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Db } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import type { SessionStore } from '../auth/sessions.js';
import { currentAuth } from '../auth/guard.js';
import { findUserById, toPublicUser, updateUser } from '../users/repository.js';
import { LanguageSchema, NewPasswordSchema, PublicUserSchema, errorResponses } from '../schemas.js';

/** FR-AUTH-05: every user can change their own password and UI language. */
export const meRoutes: FastifyPluginAsyncTypebox<{ db: Db; sessions: SessionStore }> = async (
  app,
  { db, sessions },
) => {
  app.put(
    '/me/password',
    {
      config: { allowPendingPasswordChange: true },
      schema: {
        summary: 'Change own password',
        tags: ['me'],
        body: Type.Object({
          currentPassword: Type.String({ minLength: 1, maxLength: 256 }),
          newPassword: NewPasswordSchema,
        }),
        response: { 200: PublicUserSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const { user, session } = currentAuth(request);
      const { currentPassword, newPassword } = request.body;
      if (!(await verifyPassword(user.password_hash, currentPassword))) {
        return reply
          .code(400)
          .send({ error: 'WRONG_CURRENT_PASSWORD', message: 'Current password is wrong' });
      }
      if (currentPassword === newPassword) {
        return reply
          .code(400)
          .send({ error: 'PASSWORD_UNCHANGED', message: 'New password must be different' });
      }
      await updateUser(db, user.id, {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      });
      // Log out all other devices; keep this one.
      await sessions.deleteForUser(user.id, session.id);
      return toPublicUser((await findUserById(db, user.id))!);
    },
  );

  app.put(
    '/me/language',
    {
      config: { allowPendingPasswordChange: true },
      schema: {
        summary: 'Set own UI language (null = follow the browser)',
        tags: ['me'],
        body: Type.Object({ uiLanguage: Type.Union([LanguageSchema, Type.Null()]) }),
        response: { 200: PublicUserSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request) => {
      const { user } = currentAuth(request);
      await updateUser(db, user.id, { uiLanguage: request.body.uiLanguage });
      return toPublicUser((await findUserById(db, user.id))!);
    },
  );
};
