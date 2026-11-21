import type { Knex } from 'knex';

const userRef = (t: Knex.CreateTableBuilder, column: string) =>
  t.integer(column).unsigned().nullable().references('id').inTable('app_user').onDelete('SET NULL');

/**
 * Invoices, positions and status history (FR-INV-*, data model §7). Fields reserved for
 * e-invoicing and v1.1 (invoice_type, related_invoice_id, buyer_reference, VAT category per
 * position) are created now, so later releases need no migration of existing data (D2, §8).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('invoice', (t) => {
    t.increments('id').primary();
    t.string('number', 32).nullable().unique().comment('assigned on finalize only (FR-NUM-02)');
    t.enu('status', ['DRAFT', 'OPEN', 'PAID', 'CANCELLED']).notNullable().defaultTo('DRAFT');
    t.enu('invoice_type', ['INVOICE', 'PARTIAL', 'FINAL', 'CANCELLATION'])
      .notNullable()
      .defaultTo('INVOICE');
    // RESTRICT: customers with invoices can only be archived (FR-CUST-04).
    t.integer('customer_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('customer')
      .onDelete('RESTRICT');
    t.enu('document_language', ['de', 'pl', 'en']).notNullable().defaultTo('de');
    t.date('invoice_date').notNullable();
    t.date('service_date_from').notNullable();
    t.date('service_date_to').nullable();
    t.smallint('payment_term_days').unsigned().notNullable();
    t.date('due_date').notNullable();
    t.text('site_address').notNullable();
    t.text('subject').notNullable();
    t.text('intro_text').notNullable();
    t.text('closing_text').notNullable();
    t.enu('tax_mode', ['REGULAR', 'SMALL_BUSINESS_19']).notNullable();
    t.specificType('currency', 'CHAR(3)').notNullable().defaultTo('EUR');
    t.bigInteger('net_total_cents').notNullable().defaultTo(0);
    t.bigInteger('vat_total_cents').notNullable().defaultTo(0);
    t.bigInteger('gross_total_cents').notNullable().defaultTo(0);
    t.bigInteger('labour_incl_vat_cents').notNullable().defaultTo(0).comment('§ 35a EStG');
    t.json('seller_snapshot').nullable().comment('FR-COMP-05, set on finalize');
    t.json('buyer_snapshot').nullable().comment('FR-COMP-05, set on finalize');
    t.integer('related_invoice_id').unsigned().nullable().references('id').inTable('invoice');
    t.string('buyer_reference', 100).nullable().comment('Leitweg-ID (§8)');
    t.integer('pdf_file_id').unsigned().nullable().references('id').inTable('stored_file');
    t.specificType('pdf_sha256', 'CHAR(64)').nullable();
    t.datetime('finalized_at').nullable();
    userRef(t, 'finalized_by');
    t.date('paid_at').nullable();
    t.datetime('cancelled_at').nullable();
    t.text('cancel_reason').nullable();
    t.integer('version').unsigned().notNullable().defaultTo(1).comment('optimistic locking');
    userRef(t, 'created_by');
    userRef(t, 'updated_by');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status', 'invoice_date']);
    t.index(['customer_id', 'status']);
    t.index(['invoice_date']);
  });

  await knex.schema.createTable('invoice_position', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('invoice')
      .onDelete('CASCADE');
    t.smallint('sort_order').unsigned().notNullable();
    t.enu('type', ['WORK', 'MATERIAL']).notNullable();
    t.text('description').notNullable();
    t.integer('quantity_milli').unsigned().notNullable().comment('thousandths');
    t.enu('unit_code', ['HUR', 'H87', 'MTR', 'MTK', 'MTQ', 'KGM', 'LS']).notNullable();
    t.integer('unit_price_cents').unsigned().notNullable();
    t.tinyint('vat_rate').unsigned().notNullable();
    t.specificType('vat_category_code', 'CHAR(2)').notNullable().comment('EN 16931: S, Z, E, AE');
    t.bigInteger('line_total_cents').notNullable();
    t.index(['invoice_id', 'sort_order']);
  });

  await knex.schema.createTable('invoice_status_history', (t) => {
    t.increments('id').primary();
    t.integer('invoice_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('invoice')
      .onDelete('CASCADE');
    t.enu('from_status', ['DRAFT', 'OPEN', 'PAID', 'CANCELLED']).nullable();
    t.enu('to_status', ['DRAFT', 'OPEN', 'PAID', 'CANCELLED']).notNullable();
    userRef(t, 'user_id');
    t.datetime('at').notNullable().defaultTo(knex.fn.now());
    t.text('note').nullable();
    t.index(['invoice_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('invoice_status_history');
  await knex.schema.dropTableIfExists('invoice_position');
  await knex.schema.dropTableIfExists('invoice');
}
