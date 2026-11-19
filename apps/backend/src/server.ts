import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb, ensureDatabase, migrateLatest } from './db.js';

async function main(): Promise<void> {
  const { config, warnings } = loadConfig();

  // Structured JSON logs to stdout (AR-18); credentials are redacted (NFR-SEC-01).
  const logger = {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  };

  await mkdir(config.dataDir, { recursive: true });
  await ensureDatabase(config);
  const db = createDb(config);
  const app = await buildApp({ config, db, logger });

  for (const warning of warnings) app.log.warn(warning);

  // AR-03: migrations run automatically at startup.
  const applied = await migrateLatest(db);
  app.log.info({ applied }, applied.length ? 'migrations applied' : 'database schema up to date');

  // AR-18: graceful shutdown – stop accepting, finish in-flight requests, close the DB pool.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.error('shutdown timed out, exiting');
      process.exit(1);
    }, 10_000).unref();
    app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.port });
}

main().catch((err: unknown) => {
  const msg = err instanceof ConfigError ? `configuration error: ${err.message}` : 'startup failed';
  console.error(JSON.stringify({ level: 'fatal', msg, err: String(err) }));
  process.exit(1);
});
