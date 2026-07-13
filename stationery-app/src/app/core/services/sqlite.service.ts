import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'stationery_db';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff'
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pending_sync INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_id TEXT,
    category TEXT,
    purchase_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    stock_qty REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'pcs',
    sku TEXT,
    godown_location TEXT,
    pending_sync INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    bill_no TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    date TEXT NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'paid',
    amount_paid REAL NOT NULL DEFAULT 0,
    amount_due REAL NOT NULL DEFAULT 0,
    payment_method TEXT,
    cheque_no TEXT,
    pending_sync INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL,
    item_id TEXT,
    item_name TEXT,
    qty REAL,
    price REAL,
    subtotal REAL,
    discount REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    error_message TEXT
  );
`;

/**
 * Thin wrapper around @capacitor-community/sqlite giving the rest of the app
 * a single local-first data store. Domain services (Category/Item/Billing)
 * read and write directly through here; SyncService drains the sync_queue table.
 */
@Injectable({ providedIn: 'root' })
export class SqliteService {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db!: SQLiteDBConnection;
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.init();
  }

  private async init(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      // jeep-sqlite backs the web implementation with an IndexedDB-persisted wasm sqlite.
      if (!customElements.get('jeep-sqlite')) {
        await import('jeep-sqlite/loader');
        const { defineCustomElements } = await import('jeep-sqlite/loader');
        await defineCustomElements(window);
      }
      const jeepEl = document.querySelector('jeep-sqlite') ?? document.createElement('jeep-sqlite');
      if (!jeepEl.parentElement) {
        document.body.appendChild(jeepEl);
      }
      await customElements.whenDefined('jeep-sqlite');
      await this.sqlite.initWebStore();
    }

    const consistency = await this.sqlite.checkConnectionsConsistency();
    const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;
    if (consistency.result && isConn) {
      this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
    } else {
      this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    }
    await this.db.open();
    await this.db.execute(SCHEMA);
    await this.migrate();

    if (Capacitor.getPlatform() === 'web') {
      await this.sqlite.saveToStore(DB_NAME);
    }
  }

  /** Adds columns introduced after the initial CREATE TABLE for installs that already have the old schema. */
  private async migrate(): Promise<void> {
    const billItemsInfo = await this.db.query(`PRAGMA table_info(bill_items)`);
    const hasDiscountColumn = (billItemsInfo.values ?? []).some((col: any) => col.name === 'discount');
    if (!hasDiscountColumn) {
      await this.db.execute(`ALTER TABLE bill_items ADD COLUMN discount REAL NOT NULL DEFAULT 0`);
    }

    const billsInfo = await this.db.query(`PRAGMA table_info(bills)`);
    const hasChequeNoColumn = (billsInfo.values ?? []).some((col: any) => col.name === 'cheque_no');
    if (!hasChequeNoColumn) {
      await this.db.execute(`ALTER TABLE bills ADD COLUMN cheque_no TEXT`);
    }
  }

  /** Resolves once the connection is open and the schema has been created. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  async query(sql: string, values: unknown[] = []): Promise<any[]> {
    await this.readyPromise;
    const res = await this.db.query(sql, values);
    return res.values ?? [];
  }

  async run(sql: string, values: unknown[] = []): Promise<void> {
    await this.readyPromise;
    await this.db.run(sql, values);
    await this.persistWebStore();
  }

  /** Runs multiple statements as one transaction (used for bill + bill_items writes). */
  async runBatch(statements: { statement: string; values?: unknown[] }[]): Promise<void> {
    await this.readyPromise;
    await this.db.executeSet(statements);
    await this.persistWebStore();
  }

  /**
   * Wipes the local domain cache (categories/items/bills + the sync queue) so a session
   * starts clean. Called on login/logout: the cache is per-device but data is now per-user
   * on the server, so we must not let one user's cached rows leak into another's session.
   * Leaves auth_users (local account list) intact.
   */
  async clearUserData(): Promise<void> {
    await this.readyPromise;
    await this.db.execute(`
      DELETE FROM sync_queue;
      DELETE FROM bill_items;
      DELETE FROM bills;
      DELETE FROM items;
      DELETE FROM categories;
    `);
    await this.persistWebStore();
  }

  private async persistWebStore(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      await this.sqlite.saveToStore(DB_NAME);
    }
  }
}
