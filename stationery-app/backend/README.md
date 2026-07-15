# Stationery Shop — Backend API

REST API for the offline-first Ionic/Angular Stationery Shop app. Node.js + Express + MySQL.
The app keeps a local SQLite mirror (native SQLite on Android/iOS, `jeep-sqlite`/WASM over
IndexedDB on the website) and syncs against this server as the shared source of truth — the
backend itself is unaware of that local store. See `../BACKEND_PROMPT.md` and `../API_CONTRACT.md`
for the full contract.

## Prerequisites

- Node.js 20+ (tested on 26)
- MySQL 8+ running locally (`brew install mysql && brew services start mysql`)

## Setup

```bash
cd backend
cp .env.example .env          # then edit values (a working .env is already provided for local dev)

# create the database + app user (uses root with no password by default)
./setup-db.sh                 # or: ./setup-db.sh -p   if your root has a password

npm install
npm run seed                  # create schema + seed admin/admin123 (idempotent; also runs on boot)
```

Manual DB setup (equivalent to `setup-db.sh`):

```sql
CREATE DATABASE IF NOT EXISTS stationery CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stationery'@'localhost' IDENTIFIED BY 'stationery123';
GRANT ALL PRIVILEGES ON stationery.* TO 'stationery'@'localhost';
FLUSH PRIVILEGES;
```

## Run

```bash
npm run dev     # nodemon, auto-reload
# or
npm start
```

Server: `http://localhost:3000/api`. The app's `environment.apiUrl` should point here.

## Endpoints

All routes are under `/api`. Every route except `POST /auth/login` and `GET /health` requires
`Authorization: Bearer <jwt>`.

| Method | Path                    | Notes |
|--------|-------------------------|-------|
| GET    | `/health`               | Reachability probe (open). |
| POST   | `/auth/login`           | `{ username, password }` -> `{ token, user }`. |
| GET    | `/categories`           | All categories. |
| POST   | `/categories`           | `{ name }` -> `201 { id, name }`. |
| PUT    | `/categories/:id`       | `{ name }`. |
| DELETE | `/categories/:id`       | `204`. |
| GET    | `/items`                | All items (incl. `hsnCode`, `gstPercent`). |
| POST   | `/items`                | Item minus `id` (incl. optional `hsnCode`/`gstPercent`) -> `201` full item. |
| PUT    | `/items/:id`            | Full replace incl. absolute `stockQty` and `hsnCode`/`gstPercent`. |
| DELETE | `/items/:id`            | `204`. |
| GET    | `/bills`                | All bills with nested `items` (incl. GST fields). |
| POST   | `/bills`                | Full bill (incl. GST fields); server assigns `id` + a plain **8-digit** `billNo`. |
| PUT    | `/bills/:id/payment`    | Payment patch **or** full-bill edit (idempotent upsert; carries GST fields). |
| DELETE | `/bills/:id`            | `204`. |

## Business rule: stock is client-authoritative

The server never adjusts `items.stock_qty` on `POST /bills` or `DELETE /bills/:id`. The client
already queues a separate `PUT /items/:id` with the new **absolute** `stockQty`, so adjusting here
too would double-count. See §6 of `BACKEND_PROMPT.md`.

## GST tax invoices (additive)

Items carry optional `hsn_code` / `gst_percent`, and bills carry optional GST fields
(`is_gst_invoice`, `gst_type`, seller/buyer GSTIN + state codes, `taxable_amount`,
`sgst_total`/`cgst_total`/`igst_total`, `round_off`, `amount_in_words`, and per-line
`sgst`/`cgst`/`igst`/`taxable_value`). All are **nullable/defaulted**, so non-GST bills and
existing rows are unaffected. The frontend computes every tax value; the server just
persists-and-echoes them (DECIMALs cast to numbers via `Number()`). Full column list and the
GST calculation rules are in `../API_CONTRACT.md` and `../BACKEND_PROMPT.md`.

## Invoice numbering

`POST /bills` ignores any client-sent `billNo` and assigns a per-user, sequential, plain
**8-digit** invoice number (`00000001`, `00000002`, …) — see `nextBillNo` in
`src/routes/bills.routes.js`. Offline creates carry a temporary `BILL-<timestamp>` placeholder
that the client swaps for this server value on sync.

## Schema migrations

`npm run seed` is idempotent and runs on boot: it creates the schema if missing and applies
additive column migrations (multi-tenant `user_id`, and all the GST columns above) to older
installs via `information_schema` checks — so deploying this update over an existing database
adds the GST columns without data loss.

## Quick smoke test

```bash
# login
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# create a category
curl -s localhost:3000/api/categories -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Pens"}'
```

## Default credentials

`admin` / `admin123` (role `owner`) — seeded on boot to mirror the app's local account.
