import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb, ensureDatabase, migrateLatest } from './db.js';
import { seedDemoData } from './seed/demo.js';
import { INITIAL_ADMIN_USERNAME, ensureInitialAdmin } from './users/bootstrap.js';

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

  // FR-AUTH-03: bootstrap the admin account on first start.
  const bootstrap = await ensureInitialAdmin(db, config.initialAdminPassword);
  if (bootstrap.created && bootstrap.generatedPassword) {
    // Printed exactly once, on the start that creates the account (FR-AUTH-03).
    app.log.warn(
      `Created user "${INITIAL_ADMIN_USERNAME}" with the generated password ` +
        `${bootstrap.generatedPassword} – it must be changed at first login.`,
    );
  } else if (bootstrap.created) {
    app.log.info(
      `Created user "${INITIAL_ADMIN_USERNAME}" with INITIAL_ADMIN_PASSWORD – ` +
        'it must be changed at first login.',
    );
  }

  // AR-17: optional demo data for local testing – only fills an empty installation.
  if (config.seedDemo && (await seedDemoData(db))) app.log.info('demo data created');

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
