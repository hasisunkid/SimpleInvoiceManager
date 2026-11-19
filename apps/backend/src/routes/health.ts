import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { type Db, migrationStatus } from '../db.js';

const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('error')]),
  database: Type.Boolean({ description: 'Database reachable' }),
  migrations: Type.Object({
    applied: Type.Integer(),
    pending: Type.Integer(),
  }),
});

/** AR-18: GET /api/health – 200 when the DB is reachable and all migrations are applied. */
export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
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
          .send({ status: ok ? 'ok' : 'error', database: true, migrations });
      } catch (err) {
        request.log.error({ err }, 'health check failed');
        return reply
          .code(503)
          .send({ status: 'error', database: false, migrations: { applied: 0, pending: 0 } });
      }
    },
  );
};
