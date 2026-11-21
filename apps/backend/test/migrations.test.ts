import { afterAll, describe, expect, it } from 'vitest';
import { migrationStatus } from '../src/db.js';
import { createTestDatabase, type TestDatabase } from './helpers/db.js';

/**
 * NFR-OPS-01: migrations are forward-only, idempotent and work from an empty database as well as
 * from every earlier release's schema – with existing data.
 */
const databases: TestDatabase[] = [];
afterAll(async () => {
  for (const t of databases) await t.drop();
});

/** Data a user of the release with `applied` migrations could have created. */
async function seedFor(t: TestDatabase, applied: number): Promise<void> {
  if (applied >= 1) {
    await t.db('app_user').insert({
      username: 'anna',
      display_name: 'Anna Góralewicz',
      password_hash: 'x',
      role: 'ADMIN',
    });
  }
  if (applied >= 3) {
    await t.db('company_profile').where({ id: 1 }).update({ name: 'Bau Góralewicz' });
    await t.db('number_sequence').where({ id: 1 }).update({ next_value: 104, configured: true });
  }
  if (applied >= 4) {
    await t.db('customer').insert({ type: 'PRIVATE', contact_person: 'Illing', notes: '' });
  }
}

async function expectData(t: TestDatabase, applied: number): Promise<void> {
  if (applied >= 1) {
    expect((await t.db('app_user').first())?.display_name).toBe('Anna Góralewicz');
  }
  if (applied >= 3) {
    expect((await t.db('company_profile').first())?.name).toBe('Bau Góralewicz');
    expect((await t.db('number_sequence').first())?.next_value).toBe(104);
  }
  if (applied >= 4) {
    expect((await t.db('customer').first())?.contact_person).toBe('Illing');
  }
}

describe('migrations (NFR-OPS-01)', () => {
  it('upgrade every earlier schema with data to the latest one', async () => {
    const probe = await createTestDatabase('mig_probe', { migrate: false });
    databases.push(probe);
    const total = (await migrationStatus(probe.db)).pending;
    expect(total).toBeGreaterThanOrEqual(5);

    for (let applied = 0; applied < total; applied++) {
      const t = await createTestDatabase(`mig_${applied}`, { migrate: false });
      databases.push(t);
      for (let step = 0; step < applied; step++) await t.db.migrate.up();
      expect(await migrationStatus(t.db)).toEqual({ applied, pending: total - applied });
      await seedFor(t, applied);

      await t.db.migrate.latest();
      expect(await migrationStatus(t.db), `from ${applied}`).toEqual({
        applied: total,
        pending: 0,
      });
      await expectData(t, applied);
      // Idempotent: running again changes nothing.
      const [, again] = (await t.db.migrate.latest()) as [number, string[]];
      expect(again).toEqual([]);
    }
  });

  it('keep the registered order and never rename released migrations', async () => {
    const t = await createTestDatabase('mig_names');
    databases.push(t);
    const names = (await t.db('knex_migrations').orderBy('id').select('name')).map((r) => r.name);
    expect(names.slice(0, 5)).toEqual([
      '0001_app_user',
      '0002_session',
      '0003_company_style_numbering',
      '0004_customer_catalog',
      '0005_invoice',
    ]);
    expect(names).toEqual([...names].sort());
  });
});
