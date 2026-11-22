import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { type Db, migrationStatus } from '../db.js';
import { releaseNotesUrl } from '../version.js';

const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('error')]),
  database: Type.Boolean({ description: 'Database reachable' }),
  migrations: Type.Object({
    applied: Type.Integer(),
    pending: Type.Integer(),
  }),
  version: Type.String({ description: 'Running app version (AR-26), `dev` for local builds' }),
  releaseNotesUrl: Type.Union([Type.String(), Type.Null()], {
    description: 'GitHub release notes of this version, null for local builds',
  }),
});

/**
 * AR-18: GET /api/health – 200 when the DB is reachable and all migrations are applied.
 * AR-26: also reports the running version (shown on the login screen and the *Mehr* page).
 */
export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Db; version: string }> = async (
  app,
  { db, version },
) => {
  const about = { version, releaseNotesUrl: releaseNotesUrl(version) };
  app.get(
    '/health',
    {
      config: { public: true },
      schema: {
        summary: 'Health check and version',
        tags: ['system'],
        response: { 200: HealthResponse, 503: HealthResponse },
      },
      logLevel: 'warn',
    },
    async (request, reply) => {
      try {
        await db.raw('SELECT 1');
        const migrations = await migrationStatus(db);
        const ok = migrations.pending === 0;
        return reply
          .code(ok ? 200 : 503)
          .send({ status: ok ? 'ok' : 'error', database: true, migrations, ...about });
      } catch (err) {
        request.log.error({ err }, 'health check failed');
        return reply.code(503).send({
          status: 'error',
          database: false,
          migrations: { applied: 0, pending: 0 },
          ...about,
        });
      }
    },
  );
};
