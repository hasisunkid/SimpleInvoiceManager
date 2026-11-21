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
    // Calendar dates (invoice date, due date …) stay 'YYYY-MM-DD' strings – no time-zone shifts.
    typeCast(field: { type: string; string(): string | null }, next: () => unknown) {
      return field.type === 'DATE' ? field.string() : next();
    },
    // BIGINT money columns as JS numbers: cents stay far below 2^53.
    bigNumberStrings: false,
  };
}

export function createDb(config: Config): Db {
  return knex({
    client: 'mysql2',
    connection: connection(config, true),
    pool: {
      min: 0,
      max: 10,
      // READ COMMITTED avoids InnoDB gap locks, which deadlocked parallel draft saves on
      // different invoices (delete + insert of positions). Everything that must be serialized
      // uses explicit row locks (SELECT … FOR UPDATE), which work the same here. See ADR 0009.
      afterCreate(
        conn: { query(sql: string, cb: (err: Error | null) => void): void },
        done: (err: Error | null, conn: unknown) => void,
      ) {
        conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED', (err) =>
          done(err, conn),
        );
      },
    },
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

/** MariaDB deadlock / lock wait timeout – the transaction can safely be repeated. */
export function isRetryableLockError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
}

/**
 * Runs a write transaction and repeats it (up to 3 attempts) if the database aborted it because
 * of a deadlock. The callback must be safe to repeat – it runs in a fresh transaction each time.
 */
export async function transactionWithRetry<T>(
  db: Db,
  work: (trx: Knex.Transaction) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work);
    } catch (err) {
      if (attempt >= attempts || !isRetryableLockError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }
}
