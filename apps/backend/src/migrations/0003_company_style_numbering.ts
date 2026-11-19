import type { Knex } from 'knex';

/**
 * Company profile, invoice style, number range and stored files (M2).
 * company_profile, invoice_style and number_sequence are singletons (id = 1, decision D1).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('stored_file', (t) => {
    t.increments('id').primary();
    t.enu('kind', ['LOGO', 'INVOICE_PDF']).notNullable();
    t.string('path', 255).notNullable().comment('relative to DATA_DIR');
    t.string('mime_type', 100).notNullable();
    t.integer('size').unsigned().notNullable();
    t.specificType('sha256', 'CHAR(64)').notNullable();
    t.integer('width').unsigned().nullable();
    t.integer('height').unsigned().nullable();
    t.integer('created_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('company_profile', (t) => {
    t.tinyint('id').unsigned().primary();
    t.string('name', 200).notNullable().defaultTo('');
    t.string('owner_name', 200).notNullable().defaultTo('');
    t.string('street', 200).notNullable().defaultTo('');
    t.string('zip', 16).notNullable().defaultTo('');
    t.string('city', 120).notNullable().defaultTo('');
    t.specificType('country_code', 'CHAR(2)').notNullable().defaultTo('DE');
    t.string('phone', 50).notNullable().defaultTo('');
    t.string('mobile', 50).notNullable().defaultTo('');
    t.string('email', 254).notNullable().defaultTo('');
    t.string('website', 254).notNullable().defaultTo('');
    t.string('tax_number', 32).notNullable().defaultTo('');
    t.string('vat_id', 20).notNullable().defaultTo('');
    t.string('bank_name', 120).notNullable().defaultTo('');
    t.string('iban', 34).notNullable().defaultTo('');
    t.string('bic', 11).notNullable().defaultTo('');
    t.string('account_holder', 200).notNullable().defaultTo('');
    t.enu('tax_mode', ['REGULAR', 'SMALL_BUSINESS_19']).notNullable().defaultTo('REGULAR');
    t.smallint('default_payment_term_days').unsigned().notNullable().defaultTo(30);
    t.tinyint('default_vat_rate').unsigned().notNullable().defaultTo(19).comment('percent');
    t.string('signature_name', 200).notNullable().defaultTo('');
    t.integer('updated_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('company_text', (t) => {
    t.enu('kind', ['INTRO', 'CLOSING']).notNullable();
    t.enu('language', ['de', 'pl', 'en']).notNullable();
    t.text('text').notNullable();
    t.primary(['kind', 'language']);
  });

  await knex.schema.createTable('invoice_style', (t) => {
    t.tinyint('id').unsigned().primary();
    t.integer('logo_file_id').unsigned().nullable().references('id').inTable('stored_file');
    t.enu('logo_position', ['LEFT', 'RIGHT']).notNullable().defaultTo('LEFT');
    t.specificType('accent_color', 'CHAR(7)').notNullable().defaultTo('#3A7CA5');
    t.integer('updated_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('number_sequence', (t) => {
    t.tinyint('id').unsigned().primary();
    t.string('prefix', 20).notNullable().defaultTo('');
    t.tinyint('min_digits').unsigned().notNullable().defaultTo(0);
    t.integer('next_value').unsigned().notNullable().defaultTo(1);
    t.boolean('reset_yearly').notNullable().defaultTo(false);
    t.smallint('current_year').unsigned().nullable();
    t.integer('last_assigned').unsigned().nullable();
    t.boolean('configured')
      .notNullable()
      .defaultTo(false)
      .comment('start number set by admin (US #7)');
    t.integer('updated_by')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('app_user')
      .onDelete('SET NULL');
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex('company_profile').insert({ id: 1 });
  await knex('invoice_style').insert({ id: 1 });
  await knex('number_sequence').insert({ id: 1 });

  // FR-COMP-03: sensible default closing texts (as in the reference invoices); intros stay empty.
  const closing = {
    de: 'Wir bedanken uns für den Auftrag und freuen uns auf die weitere Zusammenarbeit.',
    pl: 'Dziękujemy za zlecenie i liczymy na dalszą współpracę.',
    en: 'Thank you for your order. We look forward to working with you again.',
  };
  await knex('company_text').insert([
    ...Object.keys(closing).map((language) => ({ kind: 'INTRO', language, text: '' })),
    ...Object.entries(closing).map(([language, text]) => ({ kind: 'CLOSING', language, text })),
  ]);
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'number_sequence',
    'invoice_style',
    'company_text',
    'company_profile',
    'stored_file',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
