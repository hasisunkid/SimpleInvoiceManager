import type { Knex } from 'knex';

/** Users of the app (FR-AUTH-01..05). Called app_user because USER is a SQL keyword. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_user', (t) => {
    t.increments('id').primary();
    t.string('username', 64).notNullable().unique();
    t.string('display_name', 128).notNullable();
    t.string('password_hash', 255).notNullable();
    t.enu('role', ['USER', 'ADMIN']).notNullable().defaultTo('USER');
    t.enu('ui_language', ['de', 'pl', 'en']).nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

/** Production is forward-only (NFR-OPS-01); `down` exists for local development only. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_user');
}
