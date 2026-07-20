'use strict';

// Idempotent bootstrap: create the schema if missing and ensure the shared admin exists.
// Safe to run repeatedly (on `npm run seed` and on every server boot).

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_users (
     id            CHAR(36)     NOT NULL PRIMARY KEY,
     name          VARCHAR(120) NOT NULL,
     username      VARCHAR(80)  NOT NULL UNIQUE,
     password_hash VARCHAR(255) NOT NULL,
     role          VARCHAR(40)  NOT NULL DEFAULT 'staff'
   )`,
  `CREATE TABLE IF NOT EXISTS categories (
     id   CHAR(36)     NOT NULL PRIMARY KEY,
     name VARCHAR(120) NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS items (
     id              CHAR(36)      NOT NULL PRIMARY KEY,
     name            VARCHAR(160)  NOT NULL,
     category_id     CHAR(36)      NULL,
     category        VARCHAR(120)  NULL,
     purchase_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
     selling_price   DECIMAL(10,2) NOT NULL DEFAULT 0,
     stock_qty       DECIMAL(10,2) NOT NULL DEFAULT 0,
     unit            VARCHAR(16)   NOT NULL DEFAULT 'pcs',
     sku             VARCHAR(80)   NULL,
     godown_location VARCHAR(160)  NULL,
     hsn_code        VARCHAR(20)   NULL,
     gst_percent     DECIMAL(5,2)  NULL,
     CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
   )`,
  `CREATE TABLE IF NOT EXISTS bills (
     id                CHAR(36)      NOT NULL PRIMARY KEY,
     bill_no           VARCHAR(40)   NOT NULL,
     customer_name     VARCHAR(160)  NOT NULL,
     customer_phone    VARCHAR(40)   NULL,
     date              DATETIME      NOT NULL,
     discount          DECIMAL(10,2) NOT NULL DEFAULT 0,
     total             DECIMAL(10,2) NOT NULL DEFAULT 0,
     grand_total       DECIMAL(10,2) NOT NULL DEFAULT 0,
     payment_status    VARCHAR(16)   NOT NULL DEFAULT 'paid',
     amount_paid       DECIMAL(10,2) NOT NULL DEFAULT 0,
     amount_due        DECIMAL(10,2) NOT NULL DEFAULT 0,
     payment_method    VARCHAR(16)   NULL,
     cheque_no         VARCHAR(60)   NULL,
     is_gst_invoice    TINYINT(1)    NOT NULL DEFAULT 0,
     gst_type          VARCHAR(10)   NOT NULL DEFAULT 'none',
     seller_gstin      VARCHAR(20)   NULL,
     seller_state_code VARCHAR(4)    NULL,
     buyer_gstin       VARCHAR(20)   NULL,
     buyer_state       VARCHAR(60)   NULL,
     buyer_state_code  VARCHAR(4)    NULL,
     taxable_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
     sgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     cgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     igst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     round_off         DECIMAL(10,2) NOT NULL DEFAULT 0,
     amount_in_words   VARCHAR(255)  NULL
   )`,
  `CREATE TABLE IF NOT EXISTS bill_items (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     bill_id       CHAR(36)      NOT NULL,
     item_id       CHAR(36)      NULL,
     item_name     VARCHAR(160)  NOT NULL,
     qty           DECIMAL(10,2) NOT NULL,
     price         DECIMAL(10,2) NOT NULL,
     subtotal      DECIMAL(10,2) NOT NULL,
     discount      DECIMAL(10,2) NOT NULL DEFAULT 0,
     hsn_code      VARCHAR(20)   NULL,
     gst_percent   DECIMAL(5,2)  NOT NULL DEFAULT 0,
     taxable_value DECIMAL(10,2) NULL,
     sgst          DECIMAL(10,2) NOT NULL DEFAULT 0,
     cgst          DECIMAL(10,2) NOT NULL DEFAULT 0,
     igst          DECIMAL(10,2) NOT NULL DEFAULT 0,
     CONSTRAINT fk_bill_items_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
   )`,
  // Audit archive for deleted bills: DELETE /bills/:id moves the full record here instead of
  // destroying it. Mirrors every `bills` column (incl. all GST fields) plus deletion metadata.
  // NOTE: no UNIQUE on bill_no here -- the same invoice number may legitimately recur over time.
  // (Maintenance: any new column added to `bills` must also be added here.)
  `CREATE TABLE IF NOT EXISTS deleted_bills (
     original_bill_id  CHAR(36)      NOT NULL PRIMARY KEY,
     user_id           CHAR(36)      NOT NULL,
     bill_no           VARCHAR(40)   NOT NULL,
     customer_name     VARCHAR(160)  NOT NULL,
     customer_phone    VARCHAR(40)   NULL,
     date              DATETIME      NOT NULL,
     discount          DECIMAL(10,2) NOT NULL DEFAULT 0,
     total             DECIMAL(10,2) NOT NULL DEFAULT 0,
     grand_total       DECIMAL(10,2) NOT NULL DEFAULT 0,
     payment_status    VARCHAR(16)   NOT NULL DEFAULT 'paid',
     amount_paid       DECIMAL(10,2) NOT NULL DEFAULT 0,
     amount_due        DECIMAL(10,2) NOT NULL DEFAULT 0,
     payment_method    VARCHAR(16)   NULL,
     cheque_no         VARCHAR(60)   NULL,
     is_gst_invoice    TINYINT(1)    NOT NULL DEFAULT 0,
     gst_type          VARCHAR(10)   NOT NULL DEFAULT 'none',
     seller_gstin      VARCHAR(20)   NULL,
     seller_state_code VARCHAR(4)    NULL,
     buyer_gstin       VARCHAR(20)   NULL,
     buyer_state       VARCHAR(60)   NULL,
     buyer_state_code  VARCHAR(4)    NULL,
     taxable_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
     sgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     cgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     igst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
     round_off         DECIMAL(10,2) NOT NULL DEFAULT 0,
     amount_in_words   VARCHAR(255)  NULL,
     deleted_at        DATETIME      NOT NULL,
     deleted_by        CHAR(36)      NOT NULL,
     delete_reason     VARCHAR(255)  NULL,
     INDEX idx_deleted_bills_user_deleted (user_id, deleted_at),
     INDEX idx_deleted_bills_user_orig (user_id, original_bill_id)
   )`,
  `CREATE TABLE IF NOT EXISTS deleted_bill_items (
     id              BIGINT AUTO_INCREMENT PRIMARY KEY,
     deleted_bill_id CHAR(36)      NOT NULL,
     item_id         CHAR(36)      NULL,
     item_name       VARCHAR(160)  NOT NULL,
     qty             DECIMAL(10,2) NOT NULL,
     price           DECIMAL(10,2) NOT NULL,
     subtotal        DECIMAL(10,2) NOT NULL,
     discount        DECIMAL(10,2) NOT NULL DEFAULT 0,
     hsn_code        VARCHAR(20)   NULL,
     gst_percent     DECIMAL(5,2)  NOT NULL DEFAULT 0,
     taxable_value   DECIMAL(10,2) NULL,
     sgst            DECIMAL(10,2) NOT NULL DEFAULT 0,
     cgst            DECIMAL(10,2) NOT NULL DEFAULT 0,
     igst            DECIMAL(10,2) NOT NULL DEFAULT 0,
     CONSTRAINT fk_deleted_bill_items_bill FOREIGN KEY (deleted_bill_id) REFERENCES deleted_bills(original_bill_id) ON DELETE CASCADE
   )`,
];

// Columns added after the initial schema, applied to installs that predate them. MySQL has no
// portable "ADD COLUMN IF NOT EXISTS", so each is guarded by an information_schema check.
const GST_COLUMNS = {
  items: [
    ['hsn_code', 'VARCHAR(20) NULL'],
    ['gst_percent', 'DECIMAL(5,2) NULL'],
  ],
  bill_items: [
    ['hsn_code', 'VARCHAR(20) NULL'],
    ['gst_percent', 'DECIMAL(5,2) NOT NULL DEFAULT 0'],
    ['taxable_value', 'DECIMAL(10,2) NULL'],
    ['sgst', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['cgst', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['igst', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
  ],
  bills: [
    ['is_gst_invoice', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['gst_type', "VARCHAR(10) NOT NULL DEFAULT 'none'"],
    ['seller_gstin', 'VARCHAR(20) NULL'],
    ['seller_state_code', 'VARCHAR(4) NULL'],
    ['buyer_gstin', 'VARCHAR(20) NULL'],
    ['buyer_state', 'VARCHAR(60) NULL'],
    ['buyer_state_code', 'VARCHAR(4) NULL'],
    ['taxable_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['sgst_total', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['cgst_total', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['igst_total', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['round_off', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
    ['amount_in_words', 'VARCHAR(255) NULL'],
  ],
};

async function ensureSchema() {
  for (const ddl of SCHEMA) {
    await query(ddl);
  }
  await ensureOwnership();
  await ensureGstColumns();
}

// Idempotently add the GST columns to older installs whose tables predate them.
async function ensureGstColumns() {
  for (const [table, columns] of Object.entries(GST_COLUMNS)) {
    for (const [name, definition] of columns) {
      const cols = await query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, name]
      );
      if (cols.length === 0) {
        await query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    }
  }
}

// Add the owner column (`user_id`) to each data table for installs created before
// multi-tenancy, and index it. MySQL has no portable "ADD COLUMN IF NOT EXISTS", so we
// check information_schema first.
async function ensureOwnership() {
  for (const table of ['categories', 'items', 'bills']) {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'user_id'`,
      [table]
    );
    if (cols.length === 0) {
      // Add the column and its index atomically so a re-run can't skip the index (which would
      // then fail with "duplicate key name" if it had been created by a prior partial run).
      await query(`ALTER TABLE ${table} ADD COLUMN user_id CHAR(36) NULL, ADD INDEX idx_${table}_user (user_id)`);
    }
  }
}

async function ensureAdmin() {
  let rows = await query('SELECT id FROM auth_users WHERE username = ?', ['admin']);
  if (rows.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await query(
      'INSERT INTO auth_users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), 'Admin', 'admin', hash, 'owner']
    );
    rows = await query('SELECT id FROM auth_users WHERE username = ?', ['admin']);
  }
  return rows[0].id;
}

// Any pre-existing data with no owner belongs to admin (the account it was seeded under).
async function assignOrphanDataToAdmin(adminId) {
  for (const table of ['categories', 'items', 'bills']) {
    await query(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`, [adminId]);
  }
}

async function seed() {
  await ensureSchema();
  const adminId = await ensureAdmin();
  await assignOrphanDataToAdmin(adminId);
}

module.exports = { seed, ensureSchema, ensureAdmin };

// Allow `node src/seed.js` to run it standalone.
if (require.main === module) {
  seed()
    .then(() => {
      console.log('Seed complete: schema ensured, admin/admin123 ready.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
