import type { Knex } from 'knex';

/**
 * Server-side sessions (FR-AUTH-07). The cookie carries a random token; only its HMAC is
 * stored, so a leaked database does not reveal usable session tokens.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('session', (t) => {
    t.string('id', 64).primary().comment('HMAC-SHA256 of the session token (hex)');
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('app_user')
      .onDelete('CASCADE');
    t.string('csrf_token', 64).notNullable();
    t.boolean('persistent').notNullable().defaultTo(false);
    t.datetime('expires_at').notNullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('last_seen_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('session');
}
