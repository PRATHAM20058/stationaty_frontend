# Subsystem Architecture: Backend API & Database

This document details the backend REST API, relational MySQL schema, multi-tenancy implementation, client-authoritative stock invariant, and soft-delete audit archival system for the Stationery Shop Management application.

---

## 1. Backend Stack & Runtime Environment

- **Runtime**: Node.js 20+ LTS / Node 22+
- **Framework**: Express 4.19+ (`commonjs`)
- **Database**: MySQL 8.0+
- **Driver**: `mysql2/promise` with connection pooling
- **Security**: `jsonwebtoken` (JWT bearer auth), `bcryptjs` (salted password hashing)
- **CORS Support**: Origin whitelist matching `http://localhost:8100`, `capacitor://localhost`, `http://localhost`, `https://localhost`

### Entry Point & Boot Lifecycle
The server is started via [**`src/server.js`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/backend/src/server.js), which invokes `seed()` from [**`src/seed.js`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/backend/src/seed.js) before opening the HTTP port. This guarantees that:
1. Tables are initialized if missing.
2. Additive schema migrations (e.g., GST columns, `user_id` indexes) are applied.
3. The root `admin` user is guaranteed to exist with `admin123` credentials (role `owner`).

---

## 2. Complete MySQL 8.0 Schema DDL

```sql
-- 1. Authentication & Tenant Users
CREATE TABLE IF NOT EXISTS auth_users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  username      VARCHAR(80)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(40)  NOT NULL DEFAULT 'staff'  -- 'owner' | 'staff'
);

-- 2. Categories
CREATE TABLE IF NOT EXISTS categories (
  id      CHAR(36)     NOT NULL PRIMARY KEY,
  name    VARCHAR(120) NOT NULL,
  user_id CHAR(36)     NULL,
  INDEX idx_categories_user (user_id)
);

-- 3. Items / Products
CREATE TABLE IF NOT EXISTS items (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  name            VARCHAR(160)  NOT NULL,
  category_id     CHAR(36)      NULL,
  category        VARCHAR(120)  NULL,
  purchase_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
  selling_price   DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_qty       DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit            VARCHAR(16)   NOT NULL DEFAULT 'pcs', -- 'pcs' | 'box' | 'dozen' | 'pack'
  sku             VARCHAR(80)   NULL,
  godown_location VARCHAR(160)  NULL,
  hsn_code        VARCHAR(20)   NULL,                   -- Optional GST HSN/SAC code
  gst_percent     DECIMAL(5,2)  NULL,                   -- Optional rate (0, 5, 12, 18, 28)
  user_id         CHAR(36)      NULL,
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_items_user (user_id)
);

-- 4. Active Bills / Invoices
CREATE TABLE IF NOT EXISTS bills (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  bill_no           VARCHAR(40)   NOT NULL,
  customer_name     VARCHAR(160)  NOT NULL,
  customer_phone    VARCHAR(40)   NULL,
  date              DATETIME      NOT NULL,
  discount          DECIMAL(10,2) NOT NULL DEFAULT 0,
  total             DECIMAL(10,2) NOT NULL DEFAULT 0,
  grand_total       DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status    VARCHAR(16)   NOT NULL DEFAULT 'paid', -- 'paid' | 'pending' | 'partial'
  amount_paid       DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_due        DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method    VARCHAR(16)   NULL,                    -- 'cash' | 'upi' | 'cheque' | NULL
  cheque_no         VARCHAR(60)   NULL,
  is_gst_invoice    TINYINT(1)    NOT NULL DEFAULT 0,
  gst_type          VARCHAR(10)   NOT NULL DEFAULT 'none', -- 'intra' | 'inter' | 'none'
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
  user_id           CHAR(36)      NULL,
  INDEX idx_bills_user (user_id)
);

-- 5. Active Bill Line Items
CREATE TABLE IF NOT EXISTS bill_items (
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
);

-- 6. Audit Archive: Deleted Bills
CREATE TABLE IF NOT EXISTS deleted_bills (
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
);

-- 7. Audit Archive: Deleted Bill Line Items
CREATE TABLE IF NOT EXISTS deleted_bill_items (
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
);
```

---

## 3. Crucial Rule: Client-Authoritative Stock Invariant

> [!IMPORTANT]
> **The backend must NEVER adjust `items.stock_qty` on `POST /bills` or `DELETE /bills/:id`.**

### Rationale
The application is designed for offline execution. When a bill is generated offline:
1. The client immediately subtracts purchased quantities from local stock.
2. The client queues a `POST /bills` operation.
3. For each purchased item, the client queues a separate `PUT /items/:id` containing the **new absolute `stockQty`**.

When the client reconnects to the server:
- If the server also decremented stock during `POST /bills`, and subsequently processed the queued `PUT /items/:id`, stock would be deducted **twice**.
- Likewise, on bill deletion, the client recalculates and sends restored absolute stock via `PUT /items/:id`.

**Backend Rules**:
- `POST /bills`: Persists the bill record and line items inside a transaction. Leaves `items` untouched.
- `DELETE /bills/:id`: Moves the bill to the audit archive. Leaves `items` untouched.
- `PUT /items/:id`: Writes the absolute `stockQty` received in the payload.

---

## 4. Sequential 8-Digit Invoice Numbering

Invoices are assigned sequential 8-digit numbers per tenant (`00000001`, `00000002`, etc.) via [**`nextBillNo()`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/backend/src/routes/bills.routes.js#L35-L46):

```javascript
async function nextBillNo(conn, userId) {
  const [rows] = await conn.query('SELECT bill_no FROM bills WHERE user_id = ?', [userId]);
  let max = 0;
  for (const r of rows) {
    const digits = String(r.bill_no || '').replace(/\D/g, '');
    if (!digits) continue;
    const n = parseInt(digits, 10);
    // Ignore timestamp-like legacy numbers (e.g., > 100 million)
    if (Number.isFinite(n) && n < 100000000 && n > max) max = n;
  }
  return String(max + 1).padStart(8, '0');
}
```

This numbering is generated inside the active MySQL transaction during `POST /bills`, ensuring collision-free sequences.

---

## 5. Deleted-Bill Archival System

Rather than dropping data, deleting a bill executes a transactional archival operation:

```javascript
// In DELETE /api/bills/:id
await conn.query(
  `INSERT INTO deleted_bills (original_bill_id, ${BILL_COLS_NO_ID}, deleted_at, deleted_by, delete_reason)
   SELECT id, ${BILL_COLS_NO_ID}, ?, ?, ? FROM bills WHERE id = ? AND user_id = ?`,
  [toMysqlDate(), userId, reason, id, userId]
);
await conn.query(
  `INSERT INTO deleted_bill_items (deleted_bill_id, ${BILL_ITEM_COLS})
   SELECT bill_id, ${BILL_ITEM_COLS} FROM bill_items WHERE bill_id = ?`,
  [id]
);
await conn.query('DELETE FROM bills WHERE id = ? AND user_id = ?', [id, userId]);
```

### Properties:
1. **Idempotence**: If the client sync queue replays a delete that was already executed, the server detects zero live rows and returns `204 No Content` without failing.
2. **Byte-for-Byte Restoration**: `POST /api/bills/deleted/:id/restore` copies the rows back from `deleted_bills` to `bills` using `INSERT ... SELECT`. All numbers, GST breakdowns, timestamps, and the original 8-digit invoice number are restored identically.
3. **Multi-Tenant Protection**: All queries in the archive include `user_id = req.user.id`.

---

## 6. Complete REST API Specification

Base URL: `http://<host>:3000/api` (All routes except `/auth/*` and `/health` require `Authorization: Bearer <jwt>`).

### 6.1 Authentication

| Method & Path | Body | Success | Response Description |
| :--- | :--- | :--- | :--- |
| `POST /auth/login` | `{ username, password }` | 200 | `{ token: string, user: { id, name, role } }` |
| `POST /auth/signup` | `{ name, username, password }` | 201 | `{ token: string, user: { id, name, role: 'owner' } }` |
| `GET /health` | _None_ | 200 | `{ status: "ok" }` (Open reachability probe) |

### 6.2 Categories

| Method & Path | Body | Success | Description |
| :--- | :--- | :--- | :--- |
| `GET /categories` | _None_ | 200 | Returns `[{ id, name }]` for calling user. |
| `POST /categories` | `{ name }` | 201 | Creates category, returns `{ id, name }`. |
| `PUT /categories/:id` | `{ name }` | 200 | Updates category name. |
| `DELETE /categories/:id`| _None_ | 204 | Deletes category; items linked to it set `category_id = NULL`. |

### 6.3 Items (Products)

| Method & Path | Body | Success | Description |
| :--- | :--- | :--- | :--- |
| `GET /items` | _None_ | 200 | Returns array of all products for calling user. |
| `POST /items` | Item fields minus `id` | 201 | Assigns UUID `id`, returns full item JSON. |
| `PUT /items/:id` | Full item fields minus `id` | 200 | Replaces item fields, including absolute `stockQty`. |
| `DELETE /items/:id` | _None_ | 204 | Deletes item permanently. |

### 6.4 Bills & Invoices

| Method & Path | Body | Success | Description |
| :--- | :--- | :--- | :--- |
| `GET /bills` | _None_ | 200 | All bills for calling user with nested `items: []`. |
| `POST /bills` | Full bill object | 201 | Creates bill, assigns UUID and 8-digit `billNo`. |
| `PUT /bills/:id/payment`| Payment patch OR full bill | 200 | Dual-purpose: updates payment or line items. |
| `DELETE /bills/:id` | `{ reason? }` (optional) | 204 | Moves bill & items to `deleted_bills`, returns 204. |

### 6.5 Deleted Bill Audit Archive

| Method & Path | Parameters | Success | Description |
| :--- | :--- | :--- | :--- |
| `GET /bills/deleted` | `?from=&to=&limit=&offset=` | 200 | List caller's archived bills, newest first. |
| `GET /bills/deleted/:id` | _None_ | 200 / 404 | Get single archived bill by original ID. |
| `POST /bills/deleted/:id/restore` | _None_ | 200 / 409 | Moves bill back to active tables. 409 if conflict. |
| `DELETE /bills/deleted/:id` | _None_ | 204 | Permanent hard-purge from archive. |
