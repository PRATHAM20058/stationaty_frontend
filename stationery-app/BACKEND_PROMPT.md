# Backend Build Prompt — Stationery Shop API (Node.js + Express + MySQL)

> **How to use this file:** hand this whole document to an AI coding assistant (or follow it
> yourself) to build the backend for the existing **Stationery Shop** Ionic/Angular frontend.
> It is written to be self-contained: it specifies the stack, the exact HTTP contract the
> frontend already calls, the MySQL schema, and the business rules that keep the offline-first
> client and the server consistent. Nothing here should contradict `API_CONTRACT.md` — if it
> ever does, `API_CONTRACT.md` (what the client actually sends/expects) wins.

---

## 1. Goal

Build a REST API server that the already-built frontend can talk to. The frontend is
**offline-first**: it reads/writes a local SQLite cache and replays queued writes to this
backend when online (network reconnect, app resume, every 30s, and after each write). That
client-side cache is native SQLite on Android/iOS and `jeep-sqlite` (WASM SQLite over
IndexedDB) on the website — the backend is unaware of it either way. The backend is the shared
source of truth that multiple devices sync against.

The app id / product context:
- App id: `com.mystore.stationery`
- The backend runs locally on macOS; API base URL the app is configured for: `http://localhost:3000/api`
- The frontend attaches `Authorization: Bearer <jwt>` to every request except `POST /auth/login`,
  and logs the user out on any `401`.

## 2. Tech stack (required)

- **Runtime:** Node.js 20+ (LTS)
- **Framework:** Express 4 (keep it simple; no need for NestJS)
- **Database:** MySQL 8 installed locally via Homebrew (`brew install mysql`)
- **DB driver:** `mysql2` (use the promise API and a connection pool)
- **Auth:** `jsonwebtoken` for JWTs, `bcryptjs` (or `bcrypt`) for password hashing
- **Middleware:** `cors`, `express.json()`, plus a JWT-verify middleware
- **Config:** `dotenv` — never hardcode DB credentials or the JWT secret
- **Dev convenience:** `nodemon`

Keep the codebase small and readable. Suggested layout:

```
backend/
  src/
    app.js            # express app: middleware, route mounting
    server.js         # boot: load env, create pool, listen on PORT
    db.js             # mysql2 pool + a query() helper
    auth/
      auth.routes.js  # POST /auth/login
      jwt.middleware.js
    routes/
      categories.routes.js
      items.routes.js
      bills.routes.js
    mappers.js        # snake_case row <-> camelCase JSON
    seed.js           # create schema + seed admin/admin123 (idempotent)
  .env.example
  package.json
  README.md
```

## 3. Homebrew MySQL setup (macOS)

```bash
brew install mysql
brew services start mysql          # starts MySQL and keeps it running on login
mysql_secure_installation          # (optional) set a root password

# create the database + a dedicated app user
mysql -u root -p <<'SQL'
CREATE DATABASE IF NOT EXISTS stationery CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stationery'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON stationery.* TO 'stationery'@'localhost';
FLUSH PRIVILEGES;
SQL
```

`.env` (see `.env.example`):

```
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=stationery
DB_PASSWORD=change-me
DB_NAME=stationery
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=30d
# Comma-separated allowed origins for CORS (Ionic dev server + prod site).
CORS_ORIGINS=http://localhost:8100,capacitor://localhost,http://localhost
```

> The Android app (Capacitor) issues requests from origins like `capacitor://localhost` /
> `http://localhost`, and `ionic serve` runs on `http://localhost:8100`. Allow all of these
> in CORS or the browser/webview will block the calls.

## 4. Data model → MySQL schema

The frontend's local SQLite schema is the reference. On the server, drop the client-only
columns (`pending_sync`) and the client-only `sync_queue` table entirely — the queue lives on
the device, not the server. **JSON uses camelCase; MySQL columns are snake_case** — the backend
maps between them (see `mappers.js`).

```sql
-- Users who can log in. The app mostly authenticates locally on-device; this table backs
-- the /auth/login fallback and any future server-only accounts.
CREATE TABLE IF NOT EXISTS auth_users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  username      VARCHAR(80)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(40)  NOT NULL DEFAULT 'staff'
);

CREATE TABLE IF NOT EXISTS categories (
  id   CHAR(36)     NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  name            VARCHAR(160)  NOT NULL,
  category_id     CHAR(36)      NULL,
  category        VARCHAR(120)  NULL,           -- denormalised category name (client convenience)
  purchase_price  DECIMAL(10,2) NOT NULL DEFAULT 0,
  selling_price   DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock_qty       DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit            VARCHAR(16)   NOT NULL DEFAULT 'pcs',  -- pcs | box | dozen | pack
  sku             VARCHAR(80)   NULL,
  godown_location VARCHAR(160)  NULL,
  hsn_code        VARCHAR(20)   NULL,           -- GST: HSN/SAC code (additive, nullable)
  gst_percent     DECIMAL(5,2)  NULL,           -- GST: rate 0/5/12/18/28 (additive, nullable)
  CONSTRAINT fk_items_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  bill_no           VARCHAR(40)   NOT NULL,
  customer_name     VARCHAR(160)  NOT NULL,
  customer_phone    VARCHAR(40)   NULL,
  date              DATETIME      NOT NULL,        -- store the client's ISO-8601 instant (UTC)
  discount          DECIMAL(10,2) NOT NULL DEFAULT 0,   -- sum of per-line discounts
  total             DECIMAL(10,2) NOT NULL DEFAULT 0,   -- sum of line gross subtotals
  grand_total       DECIMAL(10,2) NOT NULL DEFAULT 0,   -- non-GST: total - discount; GST: taxable + taxes + round_off
  payment_status    VARCHAR(16)   NOT NULL DEFAULT 'paid', -- paid | pending | partial
  amount_paid       DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_due        DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method    VARCHAR(16)   NULL,            -- cash | upi | cheque | null
  cheque_no         VARCHAR(60)   NULL,
  -- GST fields (all additive; a non-GST bill leaves these at their defaults)
  is_gst_invoice    TINYINT(1)    NOT NULL DEFAULT 0,
  gst_type          VARCHAR(10)   NOT NULL DEFAULT 'none',  -- intra | inter | none
  seller_gstin      VARCHAR(20)   NULL,
  seller_state_code VARCHAR(4)    NULL,
  buyer_gstin       VARCHAR(20)   NULL,
  buyer_state       VARCHAR(60)   NULL,
  buyer_state_code  VARCHAR(4)    NULL,
  taxable_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,   -- = total - discount
  sgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
  cgst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
  igst_total        DECIMAL(10,2) NOT NULL DEFAULT 0,
  round_off         DECIMAL(10,2) NOT NULL DEFAULT 0,   -- signed rounding to whole rupee
  amount_in_words   VARCHAR(255)  NULL
);

CREATE TABLE IF NOT EXISTS bill_items (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  bill_id       CHAR(36)      NOT NULL,
  item_id       CHAR(36)      NULL,                 -- may be null if the item was later deleted
  item_name     VARCHAR(160)  NOT NULL,             -- snapshot of the name at sale time
  qty           DECIMAL(10,2) NOT NULL,
  price         DECIMAL(10,2) NOT NULL,
  subtotal      DECIMAL(10,2) NOT NULL,             -- qty * price (gross, before discount)
  discount      DECIMAL(10,2) NOT NULL DEFAULT 0,   -- per-line discount amount
  -- GST fields (additive; 0/null on non-GST lines)
  hsn_code      VARCHAR(20)   NULL,
  gst_percent   DECIMAL(5,2)  NOT NULL DEFAULT 0,
  taxable_value DECIMAL(10,2) NULL,                 -- = subtotal - discount
  sgst          DECIMAL(10,2) NOT NULL DEFAULT 0,
  cgst          DECIMAL(10,2) NOT NULL DEFAULT 0,
  igst          DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_bill_items_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
);
```

> **GST fields are additive & backward compatible.** All columns above added for GST are
> nullable or defaulted, so existing rows and non-GST bills are unaffected. `grandTotal` for a
> non-GST bill still equals `total - discount`. The frontend computes all tax values; the server
> persists-and-echoes them (cast DECIMALs with `Number()`), and may ignore any it doesn't store.

Notes:
- **IDs are opaque strings.** Use `CHAR(36)` UUIDs (e.g. `crypto.randomUUID()`), generated by the
  server on create. The client never assumes numeric ids: offline-created records carry a
  temporary `local-<timestamp>-<rand>` id which the client swaps for the server's real id once
  the create syncs (it uses the `id` in your create response to do the remap).
- Money/qty use `DECIMAL(10,2)`. The client treats them as plain numbers, so serialize them back
  as JSON **numbers**, not strings (`mysql2` returns DECIMAL as strings — cast with `Number()` in
  the mapper).

## 5. HTTP API contract

All routes are under the base path `/api` (so the app's `apiUrl` = `https://host/api`). Every
route except `POST /auth/login` requires a valid `Authorization: Bearer <jwt>`; respond `401` if
the header is missing, malformed, or the token is invalid/expired (the client will log out).

### 5.1 Auth

**`POST /auth/login`**
Request: `{ "username": "string", "password": "string" }`
- Look up `auth_users` by username, verify with bcrypt.
- On success `200`:
  ```json
  { "token": "<jwt>", "user": { "id": "string", "name": "string", "role": "string" } }
  ```
  JWT payload should carry at least `{ "sub": <userId>, "exp": ... }` (30-day expiry, matching the
  client's expectation).
- On bad credentials `401`.

There is **no** `/auth/signup` endpoint — account creation happens on-device. You only need to
seed the shared admin (see §7) and implement login.

### 5.2 Categories

| Method & path            | Request body        | Success | Response body                       |
|--------------------------|---------------------|---------|-------------------------------------|
| `GET /categories`        | –                   | 200     | `[{ "id", "name" }]` (all rows)     |
| `POST /categories`       | `{ "name" }`        | 201     | `{ "id", "name" }` (server id)      |
| `PUT /categories/:id`    | `{ "name" }`        | 200     | `{ "id", "name" }` (or empty)       |
| `DELETE /categories/:id` | –                   | 204     | –                                   |

### 5.3 Items

Item JSON shape:
```json
{
  "id": "string",
  "name": "string",
  "categoryId": "string",
  "category": "string",
  "purchasePrice": 0,
  "sellingPrice": 0,
  "stockQty": 0,
  "unit": "pcs | box | dozen | pack",
  "sku": "string | null",
  "godownLocation": "string | null"
}
```

| Method & path        | Request body                | Success | Notes                                                        |
|----------------------|-----------------------------|---------|--------------------------------------------------------------|
| `GET /items`         | –                           | 200     | Return **all** items. The client searches/filters/low-stock locally; no query params expected. |
| `POST /items`        | item fields **minus** `id`  | 201     | Assign & return the new `id` and the full item.              |
| `PUT /items/:id`     | item fields **minus** `id`  | 200     | **Full replace**, including `stockQty` as an **absolute** value (see §6). |
| `DELETE /items/:id`  | –                           | 204     | –                                                            |

### 5.4 Bills

Bill JSON shape (returned by `GET /bills`, and the body of `POST /bills`):
```json
{
  "id": "string",
  "billNo": "string",
  "customerName": "string",
  "customerPhone": "string | null",
  "date": "ISO-8601 string",
  "items": [
    { "itemId": "string", "itemName": "string", "qty": 0, "price": 0, "subtotal": 0, "discount": 0 }
  ],
  "discount": 0,
  "total": 0,
  "grandTotal": 0,
  "paymentStatus": "paid | pending | partial",
  "amountPaid": 0,
  "amountDue": 0,
  "paymentMethod": "cash | upi | cheque | null",
  "chequeNo": "string | undefined"
}
```

| Method & path            | Request body                          | Success | Notes |
|--------------------------|---------------------------------------|---------|-------|
| `GET /bills`             | –                                     | 200     | Return **all** bills with their `items` array nested. Client filters by date/status/customer locally. |
| `POST /bills`            | full bill object (see below)          | 201     | Persist bill + its line items in one transaction. **Ignore** any incoming `id`/`billNo` and assign your own; return the full bill with the server `id` and `billNo`. |
| `PUT /bills/:id/payment` | payment patch **or** full bill        | 200     | Dual-purpose — see below. |
| `DELETE /bills/:id`      | –                                     | 204     | Delete the bill and its `bill_items` (FK cascade). |

**`POST /bills` details.** The client sends the whole bill (including the additive GST fields)
plus a *temporary* local `id` (`local-...`) and a placeholder `billNo` (`BILL-<timestamp>`).
Do **not** trust the client id/billNo:
- Generate a fresh UUID `id`.
- Assign a per-user, sequential, plain **8-digit** `billNo` (`00000001`, `00000002`, …). The
  reference implementation's `nextBillNo` takes the largest numeric suffix across the user's
  existing `bill_no`s (robust to any legacy `BILL-00000x` rows) and zero-pads `+1` to 8 digits.
- Insert the bill row and one `bill_items` row per `items[]` entry, inside a transaction.
- Respond `201` with the complete stored bill (server `id`, server `billNo`, echoed items/totals
  including the GST columns). The client replaces its local id/billNo with these on sync.

**`PUT /bills/:id/payment` is dual-purpose.** The client's sync engine replays two different
"update bill" cases through this one endpoint:
1. **Payment change** (Mark as Paid / Record Payment / add-or-edit cheque no.). Body is a small
   patch:
   ```json
   { "paymentStatus": "paid | partial", "amountPaid": 0, "amountDue": 0,
     "paymentMethod": "cash | upi | cheque", "chequeNo": "string | undefined" }
   ```
2. **Edit line items** (Edit Items on the bill detail page). Body is the **full recomputed bill**
   (new `items`, `total`, `discount`, `grandTotal`, and recalculated `amountPaid`/`amountDue`/
   `paymentStatus`).

Implement it as an **idempotent upsert of the bill by `:id`**: update whatever fields are present
in the body; if an `items` array is present, replace the bill's `bill_items` rows with it, all in a
transaction. Return `200`. (Treating it as "apply the fields given" handles both cases without
branching on which one it is.)

## 6. Stock is client-authoritative — do NOT double-count

**This is the most important business rule.** The frontend manages stock quantities itself:
- When a bill is **created**, the client decrements each line item's local `stock_qty` and queues a
  separate `PUT /items/:id` carrying the **new absolute** `stockQty` — *in addition to* the
  `POST /bills`.
- When a bill is **deleted**, the client adds the quantities back and likewise queues
  `PUT /items/:id` with the restored absolute `stockQty`.

Therefore the server must **treat `PUT /items/:id`'s `stockQty` as the source of truth and NOT
auto-adjust stock on `POST /bills` or `DELETE /bills/:id`.** If the server also decremented on bill
create, stock would be reduced twice (once by the item PUT, once by the bill POST). So:
- `POST /bills`: persist the bill only. **Do not touch `items.stock_qty`.**
- `DELETE /bills/:id`: delete the bill only. **Do not restore stock.**
- `PUT /items/:id`: write the absolute `stockQty` you were given.

(If you later want the server to be authoritative for stock instead, that's a bigger design change
and would require the client to stop sending absolute stock — out of scope for v1.)

## 7. Auth & seeding details

- On startup, run `seed.js` (idempotent): create the schema if missing, and ensure an admin user
  exists — **`username: admin`, `password: admin123`, `role: owner`** (bcrypt-hash the password).
  This mirrors the account the frontend seeds locally, so the same credentials work against the
  server as a fallback.
- JWT: sign with `JWT_SECRET`, `expiresIn = JWT_EXPIRES_IN` (30d). Payload `{ sub: userId }` is
  enough. The verify middleware puts the decoded user on `req.user` and rejects with `401` on any
  failure. The frontend only cares that (a) login returns `{ token, user }` and (b) protected
  routes 401 when the token is bad/expired.
- Passwords: hash with bcrypt (cost ~10). Never store or return plaintext or the hash.

## 8. ID remapping contract (why create responses matter)

Because records can be created offline, the client may reference **temporary local ids** that only
become real once synced. The client handles the remap *as long as your create responses return the
server id*:
- `POST /categories` and `POST /items` must return the object **with the server-assigned `id`**.
- `POST /bills` must return the server `id` **and** `billNo`.
- The client cascades a new category id into any items that referenced the temporary one, and
  rewrites `itemId`s inside queued bill payloads, before it sends dependent requests — so by the
  time a request reaches you, foreign keys should already point at real server ids. You don't need
  to resolve `local-...` ids server-side; just always assign and return real ids on create.

## 9. Validation & error conventions

- Validate types/enums (`unit`, `paymentStatus`, `paymentMethod`) and reject bad bodies with
  `400 { "message": "..." }`. The client parks a write as **failed** (not retried) on any non-network
  error, so a `4xx` should mean "this write is genuinely invalid," not "try again later."
- Distinguish **server-unreachable** from **rejected**: the client stops draining its queue only when
  a request fails at the transport level (no HTTP status). A normal `4xx`/`5xx` with a response is
  treated as "reachable but rejected." So make sure the server is actually up/reachable for healthy
  requests, and only return error statuses for real problems.
- Unknown/extra fields in request bodies should be ignored, not rejected (the client may send a
  `pendingSync` flag or a local `id`/`billNo` you don't use).
- Return JSON numbers for money/qty (cast `mysql2` DECIMAL strings via `Number()`).

## 10. Acceptance checklist

The backend is "done for v1" when, against the running frontend pointed at it:
- [ ] `POST /auth/login` with `admin`/`admin123` returns a working JWT; a bad password returns 401.
- [ ] Protected routes return 401 without a valid token (and the app redirects to login).
- [ ] `GET /categories`, `GET /items`, `GET /bills` return the full collections in the shapes above,
      with bills carrying nested `items`.
- [ ] Creating a category/item/bill offline then reconnecting: the queued creates POST successfully,
      the server assigns ids (and `billNo` for bills), and the client's "Pending sync" tags clear.
- [ ] Recording a payment / marking paid / editing cheque no. replays through `PUT /bills/:id/payment`
      and persists.
- [ ] Editing a bill's line items replays through `PUT /bills/:id/payment` (full-bill body) and
      replaces the stored line items + totals.
- [ ] Deleting a bill removes it and its line items.
- [ ] Stock is **not** double-counted: after generating a bill, an item's `stockQty` on the server
      matches the client's (reduced once, via the item PUT), and deleting the bill restores it once.
- [ ] CORS allows `ionic serve` (`http://localhost:8100`) and the Capacitor webview origins.

## 11. Out of scope for v1 (don't build yet)

- Pagination / query params on `GET /items` and `GET /bills` (client caches and filters locally).
- Server-side conflict resolution / merge (v1 is last-synced-write-wins by design).
- A `/auth/signup` endpoint (signup is on-device only).
- Server-authoritative stock ledger (client owns stock in v1 — see §6).
- Reports/analytics endpoints — the dashboard and reports pages compute Top/Low sellers, low stock,
  daily sales, and pending totals entirely client-side from the cached collections.
```
