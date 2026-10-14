# Subsystem Architecture: Offline-First Synchronization & Storage

This document details the client-side data persistence, offline queuing engine, background synchronization pipeline, and entity ID remapping architecture of the Stationery Shop Management System.

---

## 1. High-Level Flow Diagram

```
                     User Interaction (POS / Inventory / Payments)
                                        │
                                        ▼
                           Angular Domain Services
                  (BillingService, ItemService, CategoryService)
                                        │
                ┌───────────────────────┴───────────────────────┐
                ▼                                               ▼
     1. Local SQLite Write                           2. Enqueue Write
     - Instant UI feedback                           - Record in `sync_queue` table
     - Temporary ID assigned                         - Action: 'create' | 'update' | 'delete'
     - Pending flag = 1                              - Status = 'pending'
                │                                               │
                │                                               ▼
                │                                   SyncTriggerService.requestSync()
                │                                               │
                │                                               ▼
                │                                       SyncService.sync()
                │                               (Drains queue oldest first)
                │                                               │
                │                        ┌──────────────────────┴──────────────────────┐
                │                        ▼                                             ▼
                │                  If Online                                     If Offline
                │           - Replay HTTP request                          - Pause queue drain
                │           - If 'create': get server ID                   - Keep rows 'pending'
                │           - Remap local IDs in SQLite                    - Show Yellow Offline Banner
                │           - Update pending_sync = 0
                │           - Mark queue row 'synced'
                │                        │
                ▼                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                Local SQLite Database                                   │
│            (Native on Android/iOS / jeep-sqlite WASM over IndexedDB on Web)            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Dual-Engine SQLite Architecture

The application requires relational SQL capabilities on the client to allow complex querying (e.g., product search across SKU, name, and godown location; date-range bill aggregations; low-stock filtering) without network overhead.

To support both **Native Mobile** and **Desktop Web Browser** environments transparently, [**`SqliteService`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/sqlite.service.ts) detects the running platform via `Capacitor.getPlatform()` and initializes the appropriate SQLite driver.

### Platform Engine Selection

```typescript
// Core driver selection logic in SqliteService.init()
if (Capacitor.getPlatform() === 'web') {
  // Web: Register jeep-sqlite custom element and load WebAssembly
  if (!customElements.get('jeep-sqlite')) {
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

// Android / iOS / Web: Create or retrieve DB connection
this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
await this.db.open();
await this.db.execute(SCHEMA);
await this.migrate();
```

1. **Android / iOS**:
   - Uses `@capacitor-community/sqlite` native bridge.
   - Database files (`stationery_db.db`) reside in native application sandbox storage.
   - High performance, multi-threaded native filesystem I/O.
2. **Web Browser (`ionic serve`, PWA)**:
   - Uses `jeep-sqlite` WebAssembly engine (`sql-wasm.wasm`).
   - SQLite tables are maintained in memory during execution and flushed to browser **IndexedDB** on every write via `this.sqlite.saveToStore(DB_NAME)`.
   - **Crucial Dependency Requirement**: The WebAssembly binary located at `src/assets/sql-wasm.wasm` must strictly match the `sql.js` version compiled into `jeep-sqlite` (version `1.11.0` for `jeep-sqlite@2.8.0`). Mismatches cause a WebAssembly `LinkError: function import requires a callable` and stall initialization.

---

## 3. Client-Side SQLite Schema & Migrations

The local database mirrors the server-side business entities, with the addition of synchronization columns and a queue table:

```sql
-- Client SQLite Schema definition
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
  hsn_code TEXT,
  gst_percent REAL,
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
  is_gst_invoice INTEGER DEFAULT 0,
  gst_type TEXT DEFAULT 'none',
  seller_gstin TEXT,
  seller_state_code TEXT,
  buyer_gstin TEXT,
  buyer_state TEXT,
  buyer_state_code TEXT,
  taxable_amount REAL DEFAULT 0,
  sgst_total REAL DEFAULT 0,
  cgst_total REAL DEFAULT 0,
  igst_total REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  amount_in_words TEXT,
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
  discount REAL NOT NULL DEFAULT 0,
  hsn_code TEXT,
  gst_percent REAL DEFAULT 0,
  taxable_value REAL,
  sgst REAL DEFAULT 0,
  cgst REAL DEFAULT 0,
  igst REAL DEFAULT 0
);

-- Write-Ahead Queue for Server Synchronization
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,         -- 'item' | 'category' | 'bill'
  action TEXT NOT NULL,              -- 'create' | 'update' | 'delete'
  entity_id TEXT NOT NULL,           -- Local ID or Server UUID
  payload TEXT NOT NULL,             -- JSON stringified payload
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'synced' | 'failed'
  created_at TEXT NOT NULL,          -- ISO timestamp
  error_message TEXT
);
```

### Dynamic Column Migrations
SQLite does not natively support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. To safely upgrade client databases across versions, [**`SqliteService.migrate()`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/sqlite.service.ts#L140-L168) queries `PRAGMA table_info(<table>)` before dynamically applying missing column statements (e.g., adding GST fields, `cheque_no`, and line discounts).

---

## 4. Temporary IDs & Entity ID Remapping

When the device is offline, new entities cannot obtain a server-assigned UUID or official invoice number. The application uses a robust client-side generation and subsequent remapping workflow:

### A. Generation
- **Items & Categories**: `generateLocalId()` creates an ID formatted as:  
  `local-<timestamp>-<randomInteger>` (e.g., `local-1728900000000-4821`).
- **Bills**: `generateLocalId()` assigns the temporary record ID, while the invoice number receives a provisional placeholder:  
  `BILL-<timestamp>` (e.g., `BILL-1728900000000`).

### B. The Remapping Pipeline
When [**`SyncService`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/sync.service.ts) replays a `create` action:

```typescript
// SyncService.processRow:
if (row.action === 'create') {
  const { id: newId } = await service.pushCreate(row.entity_id, payload);
  if (newId && newId !== row.entity_id) {
    idRemap.set(row.entity_id, newId);
    if (service.remapLocalId) {
      await service.remapLocalId(row.entity_id, newId);
    }
  }
}
```

1. **Foreign Key Cascade in Memory**:
   If a category was created offline (`local-cat-1`), and subsequent items in the queue reference `local-cat-1`, `applyRemap()` replaces `categoryId: 'local-cat-1'` with the new server UUID before submitting the item to `POST /api/items`.
2. **Foreign Key Cascade in SQLite**:
   `CategoryService.remapLocalId(oldId, newId)` updates local SQLite records:
   ```sql
   UPDATE items SET category_id = ? WHERE category_id = ?;
   ```
3. **Bill Number Swapping**:
   When `POST /api/bills` resolves, the server returns the official sequential 8-digit bill number (e.g., `00000042`) and new UUID. `BillingService.pushCreate()` executes an atomic batch update:
   ```sql
   UPDATE bills SET id = ?, bill_no = ?, pending_sync = 0 WHERE id = ?;
   UPDATE bill_items SET bill_id = ? WHERE bill_id = ?;
   ```
   It then emits on `BillingService.remapped$`, prompting active UI views (like the Bill Detail page) to seamlessly swap the placeholder text with the real invoice number without requiring user navigation.

---

## 5. SyncService Execution & Trigger Engine

The synchronization engine operates automatically across multiple lifecycle events without polling loops:

```typescript
// Background listeners initialized in SyncService.start()
Network.addListener('networkStatusChange', (s) => {
  this.isOnline = s.connected;
  this.updateState();
  if (this.isOnline) this.sync();
});

App.addListener('resume', () => {
  if (this.isOnline) this.sync();
});

this.syncTrigger.onTrigger$.subscribe(() => {
  if (this.isOnline) this.sync();
});

setInterval(() => {
  if (this.isOnline) this.sync();
}, 30_000);
```

### Sync Trigger Vectors:
1. **Network Reconnection**: Triggered by Capacitor Network plugin when device transitions from disconnected to connected.
2. **Application Resume**: Triggered when the user switches back to the application from background/sleep.
3. **Immediate Write-Through**: Whenever an entity is mutated via `ItemService`, `CategoryService`, or `BillingService`, the service enqueues the action and immediately calls `SyncTriggerService.requestSync()`. This ensures writes upload within milliseconds if network is healthy.
4. **Periodic Heartbeat**: Fallback timer executing every 30 seconds to catch edge cases where listeners missed a state transition.

### Error Classification & Queue Parking

`SyncService.processRow()` distinguishes network transport loss from HTTP server rejections:

- **Transport Failure (`err.status === 0` or undefined)**:
  Indicates DNS lookup failure, connection refused, or gateway timeout. The sync run **aborts immediately**; the current row remains `pending` and `isOnline` is set to `false`. Remaining queue items are left untouched for the next cycle.
- **Server Rejection (`err.status >= 400`)**:
  Indicates the backend was reached but rejected the payload (e.g., validation failure, entity not found). The row is marked as `failed` with its `error_message` preserved in `sync_queue`. The engine **continues processing** subsequent queue items so one bad write does not freeze the entire system.

---

## 6. Multi-Tenancy & Session Cleanup Boundary

Because multiple shop staff or owners may use the same physical device/browser, local cache cross-contamination must be prevented.

Data in the remote MySQL database is strictly scoped by `user_id`. Therefore, whenever `AuthService.login()` or `AuthService.logout()` executes, it immediately calls:

```typescript
await this.sqlite.clearUserData();
```

Which executes:
```sql
DELETE FROM sync_queue;
DELETE FROM bill_items;
DELETE FROM bills;
DELETE FROM items;
DELETE FROM categories;
```

> **Note**: The `auth_users` table and `SellerConfig` stored in `@capacitor/preferences` are preserved across session wipes so hardware-specific settings and shop GST identity remain intact.

---

## 7. Conflict Resolution Model

The system follows a strict **Last-Synced-Write-Wins (LWW)** model for V1:
- If an item's stock or pricing is edited on two separate offline devices, whichever device syncs last will overwrite the previous server value.
- Inventory deductions during billing send the final recalculated absolute `stockQty`, maintaining consistency with the selling device's state.
- Conflict merging and operational transformation (OT) are intentionally avoided to keep POS latency deterministic and transaction boundaries simple.
