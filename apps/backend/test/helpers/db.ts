import { inject } from 'vitest';
import { loadConfig, type Config } from '../../src/config.js';
import { createDb, ensureDatabase, migrateLatest, type Db } from '../../src/db.js';

/**
 * Integration tests run against a real MariaDB (TR-02), started once in global-setup.ts.
 * Each test file gets its own, freshly created database.
 */
export interface TestDatabase {
  readonly config: Config;
  readonly db: Db;
  /** Drops the database and closes the pool. */
  drop(): Promise<void>;
}

let counter = 0;

export function testConfig(name: string): Config {
  const server = inject('testDbServer');
  counter += 1;
  const { config } = loadConfig({
    DB_HOST: server.host,
    DB_PORT: String(server.port),
    DB_USER: server.user,
    DB_PASSWORD: server.password,
    DB_NAME: `t_${name}_${process.pid}_${counter}`,
    SESSION_SECRET: 'test-session-secret-'.padEnd(40, 'x'),
    LOG_LEVEL: 'silent',
  });
  return config;
}

export async function createTestDatabase(
  name: string,
  { migrate = true }: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const config = testConfig(name);
  await ensureDatabase(config);
  const db = createDb(config);
  if (migrate) await migrateLatest(db);
  return {
    config,
    db,
    drop: async () => {
      await db.raw('DROP DATABASE IF EXISTS ??', [config.db.database]).catch(() => {});
      await db.destroy();
    },
  };
}
