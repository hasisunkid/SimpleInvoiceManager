import type { Knex } from 'knex';
import * as m0001 from './0001_app_user.js';

/**
 * Migrations are registered explicitly instead of being discovered on disk, so they work
 * the same from TypeScript sources (dev, tests) and from compiled output (container).
 *
 * Rules (NFR-OPS-01): forward-only. Never edit or delete a released migration – add a new one.
 */
interface Migration {
  up(knex: Knex): Promise<void>;
  down(knex: Knex): Promise<void>;
}

type Entry = readonly [name: string, migration: Migration];

const migrations: readonly Entry[] = [['0001_app_user', m0001]];

export const migrationSource: Knex.MigrationSource<Entry> = {
  getMigrations: () => Promise.resolve([...migrations]),
  getMigrationName: ([name]) => name,
  getMigration: ([, migration]) => Promise.resolve(migration),
};
