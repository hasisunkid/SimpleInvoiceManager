import type { Knex } from 'knex';

const MARKED_TABLES = ['invoice', 'customer', 'catalog_item'] as const;

/**
 * MCP server (M9, §4.10): personal API tokens (FR-MCP-03) and the "created by AI" marker on
 * invoices, customers and catalogue entries (FR-MCP-10). Existing rows become `UI`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('api_token', (t) => {
    t.increments('id').primary();
    t.integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('app_user')
      .onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.specificType('token_hash', 'CHAR(64)').notNullable().unique().comment('SHA-256 (hex)');
    t.string('token_prefix', 16).notNullable().comment('first characters, shown in lists');
    t.string('scopes', 200).notNullable();
    t.datetime('expires_at').nullable();
    t.datetime('last_used_at').nullable();
    t.datetime('revoked_at').nullable();
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });

  for (const table of MARKED_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.enu('created_via', ['UI', 'MCP']).notNullable().defaultTo('UI');
      t.integer('created_via_token_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('api_token')
        .onDelete('SET NULL');
      t.datetime('ai_reviewed_at').nullable();
      t.index(['created_via', 'ai_reviewed_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of MARKED_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropIndex(['created_via', 'ai_reviewed_at']);
      t.dropForeign(['created_via_token_id']);
      t.dropColumns('created_via', 'created_via_token_id', 'ai_reviewed_at');
    });
  }
  await knex.schema.dropTableIfExists('api_token');
}
