import type { Knex } from 'knex';

/** Customers (FR-CUST-*) and the position catalogue (FR-CAT-*) – M3. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('customer', (t) => {
    t.increments('id').primary();
    t.enu('type', ['BUSINESS', 'PRIVATE']).notNullable();
    t.string('company_name', 200).notNullable().defaultTo('');
    t.string('contact_person', 200).notNullable().defaultTo('');
    t.string('street', 200).notNullable().defaultTo('');
    t.string('zip', 16).notNullable().defaultTo('');
    t.string('city', 120).notNullable().defaultTo('');
    t.specificType('country_code', 'CHAR(2)').notNullable().defaultTo('DE');
    t.string('email', 254).notNullable().defaultTo('');
    t.string('phone', 50).notNullable().defaultTo('');
    t.string('vat_id', 20).notNullable().defaultTo('');
    t.enu('invoice_language', ['de', 'pl', 'en']).notNullable().defaultTo('de');
    t.text('notes').notNullable();
    t.boolean('archived').notNullable().defaultTo(false);
    t.integer('created_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.integer('updated_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    // Search (FR-CUST-02) runs LIKE '%…%' over these columns; with ≤ 5 000 rows a scan of the
    // narrow index is well below the 300 ms budget. Collation utf8mb4_unicode_ci makes the
    // search case- and accent-insensitive ("goralewicz" finds "Góralewicz").
    t.index(['archived', 'company_name', 'contact_person', 'city'], 'customer_search_idx');
  });

  await knex.schema.createTable('catalog_item', (t) => {
    t.increments('id').primary();
    t.enu('type', ['WORK', 'MATERIAL']).notNullable();
    t.string('title', 120).notNullable();
    t.text('description').notNullable();
    t.enu('unit_code', ['HUR', 'H87', 'MTR', 'MTK', 'MTQ', 'KGM', 'LS']).notNullable();
    t.integer('unit_price_cents').unsigned().notNullable();
    t.tinyint('vat_rate').unsigned().notNullable().comment('percent');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.integer('updated_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['active', 'type', 'title']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('catalog_item');
  await knex.schema.dropTableIfExists('customer');
}
