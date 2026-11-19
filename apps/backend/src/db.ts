import knex, { type Knex } from 'knex';
import type { Config } from './config.js';
import { migrationSource } from './migrations/index.js';

export type Db = Knex;

function connection(config: Config, withDatabase: boolean): Knex.MySql2ConnectionConfig {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(withDatabase ? { database: config.db.database } : {}),
    charset: 'utf8mb4',
    // Store and read DATETIME/TIMESTAMP as UTC.
    timezone: 'Z',
    // DECIMAL columns come back as strings – money uses integer cents anyway (AR-08).
    decimalNumbers: false,
    supportBigNumbers: true,
  };
}

export function createDb(config: Config): Db {
  return knex({
    client: 'mysql2',
    connection: connection(config, true),
    pool: { min: 0, max: 10 },
    migrations: { migrationSource, tableName: 'knex_migrations' },
  });
}

/**
 * Creates the app's own database if it does not exist (AR-12).
 * The name was validated in loadConfig and is passed as a quoted identifier (??).
 */
export async function ensureDatabase(config: Config): Promise<void> {
  const admin = knex({
    client: 'mysql2',
    connection: connection(config, false),
    pool: { min: 0, max: 1 },
  });
  try {
    await admin.raw(
      'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      [config.db.database],
    );
  } finally {
    await admin.destroy();
  }
}

export interface MigrationStatus {
  readonly applied: number;
  readonly pending: number;
}

export async function migrationStatus(db: Db): Promise<MigrationStatus> {
  const [completed, pending] = (await db.migrate.list()) as [unknown[], unknown[]];
  return { applied: completed.length, pending: pending.length };
}

/** Applies all pending migrations; returns the names of those applied in this run. */
export async function migrateLatest(db: Db): Promise<string[]> {
  const [, applied] = (await db.migrate.latest()) as [number, string[]];
  return applied;
}
