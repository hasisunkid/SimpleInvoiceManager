import { existsSync } from 'node:fs';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { handleError } from './errors.js';
import { registerAuthGuard } from './auth/guard.js';
import { createLoginRateLimiter, type LoginRateLimiter } from './auth/rate-limiter.js';
import { SessionStore } from './auth/sessions.js';
import { FileStore } from './files/store.js';
import { PdfMakeInvoiceRenderer } from './pdf/pdfmake-renderer.js';
import type { InvoiceRenderer } from './pdf/types.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { companyRoutes } from './routes/company.js';
import { customerRoutes } from './routes/customers.js';
import { settingsRoutes } from './routes/settings.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { userRoutes } from './routes/users.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Path under which the browser reaches the app: the Home Assistant ingress path
     * (X-Ingress-Path header, AR-13) or "" for direct access. Used e.g. for cookie paths.
     */
    basePath: string;
  }
}

export interface AppDeps {
  readonly config: Config;
  readonly db: Db;
  readonly logger?: FastifyServerOptions['logger'];
  /** Injectable for tests; defaults to 5 failures → 1 min lock per username (FR-AUTH-06). */
  readonly rateLimiter?: LoginRateLimiter;
  /** AR-06: injectable invoice renderer (default: pdfmake). */
  readonly renderer?: InvoiceRenderer;
}

/** Accepts only a plain absolute path from the ingress header – never a URL. */
export function sanitizeIngressPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\/[A-Za-z0-9/_.-]*$/.test(value) || value.includes('..')) return '';
  return value.replace(/\/+$/, '');
}

export async function buildApp({
  config,
  db,
  logger = false,
  rateLimiter = createLoginRateLimiter(),
  renderer = new PdfMakeInvoiceRenderer(),
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: true, coerceTypes: 'array', useDefaults: true } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorateRequest('basePath', '');
  app.addHook('onRequest', async (request) => {
    request.basePath = sanitizeIngressPath(request.headers['x-ingress-path']);
  });

  // Uniform error body { error, message } (NFR-UX-03: the UI translates the code).
  app.setErrorHandler<FastifyError>(handleError);

  await app.register(fastifyCookie);
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'SimpleInvoice Manager API', version: '0.1.0' },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'sim_session' },
          csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
        },
      },
      security: [{ session: [], csrf: [] }],
    },
  });

  const sessions = new SessionStore(db, config.sessionSecret);
  const files = new FileStore(db, config.dataDir);

  await app.register(
    async (api) => {
      registerAuthGuard(api, sessions);
      await api.register(healthRoutes, { db });
      await api.register(authRoutes, { db, sessions, rateLimiter });
      await api.register(meRoutes, { db, sessions });
      await api.register(userRoutes, { db, sessions });
      await api.register(companyRoutes, { db });
      await api.register(customerRoutes, { db });
      await api.register(catalogRoutes, { db });
      await api.register(settingsRoutes, { db, files, renderer });
      api.get('/openapi.json', { config: { public: true }, schema: { hide: true } }, async () =>
        app.swagger(),
      );
    },
    { prefix: '/api' },
  );

  if (existsSync(config.frontendDir)) {
    await app.register(fastifyStatic, {
      root: config.frontendDir,
      wildcard: false,
      index: ['index.html'],
      // Hashed assets may be cached forever; index.html must always be revalidated.
      setHeaders(reply, filePath) {
        reply.header(
          'Cache-Control',
          filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        );
      },
    });
  } else {
    app.log.warn({ frontendDir: config.frontendDir }, 'frontend build not found – API only');
  }

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send({ error: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}
