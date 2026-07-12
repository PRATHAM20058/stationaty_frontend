# API Contract

Base URL is whatever `environment.apiUrl` is set to (e.g. `https://mystore.duckdns.org/api`).
All endpoints below are relative to that base. All requests except `POST /auth/login`
must include `Authorization: Bearer <jwt>` (attached automatically by the app's HTTP
interceptor). A `401` response anywhere logs the user out and redirects to `/login`.

## Auth

### `POST /auth/login`

Request:
```json
{ "username": "string", "password": "string" }
```

Response `200`:
```json
{
  "token": "jwt-string",
  "user": { "id": "string", "name": "string", "role": "string" }
}
```

Response `401` on bad credentials.

Note: there's no `/auth/signup` (or equivalent) endpoint. Account creation currently
happens entirely on-device (a local SQLite `auth_users` table, seeded with an
`admin`/`admin123` account) so the app is usable before a backend exists. A username
not found locally falls through to this endpoint, so login against a real backend
works transparently once one exists — but the signup page itself has no server call
to implement yet.

## Categories

### `GET /categories`
Returns all categories.
```json
[{ "id": "string", "name": "string" }]
```

### `POST /categories`
Request: `{ "name": "string" }`
Response `201`: `{ "id": "string", "name": "string" }`

### `PUT /categories/:id`
Request: `{ "name": "string" }`
Response `200`.

### `DELETE /categories/:id`
Response `204`.

## Items

### `GET /items`
Returns all items (frontend does search/filter/low-stock locally against its cache).
```json
[{
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
}]
```

### `POST /items`
Request body: item fields minus `id`.
Response `201`: full item including server-assigned `id`.

### `PUT /items/:id`
Request body: item fields minus `id` (full replace, including `stockQty` — the app
sends the item's new absolute stock quantity after billing reduces it, not a delta).
Response `200`.

### `DELETE /items/:id`
Response `204`.

## Bills

### `GET /bills`
Returns all bills (frontend filters by date/status/customer locally).
```json
[{
  "id": "string",
  "billNo": "string",
  "customerName": "string",
  "customerPhone": "string | null",
  "date": "ISO 8601 string",
  "items": [{ "itemId": "string", "itemName": "string", "qty": 0, "price": 0, "subtotal": 0, "discount": 0 }],
  "discount": 0,
  "total": 0,
  "grandTotal": 0,
  "paymentStatus": "paid | pending | partial",
  "amountPaid": 0,
  "amountDue": 0,
  "paymentMethod": "cash | upi | cheque | null",
  "chequeNo": "string | undefined (only meaningful when paymentMethod is 'cheque'; optional, may be added after the bill is created)"
}]
```

### `POST /bills`
Request body: bill fields minus `id` (the app generates a temporary `billNo` and `id`
locally when offline; the server's response values replace them once synced).
Response `201`: full bill including server-assigned `id` and `billNo`. Expected to
also decrement the corresponding items' stock server-side.

Discounts are applied per line item, not as a single bill-wide amount: each entry in
`items` carries its own `discount` (a monetary amount, already converted from % if the
user chose percent-based discounting in the UI). `total` is the sum of each line's
gross `subtotal` (qty × price, before discount); the bill-level `discount` is the sum
of every line's `discount`; `grandTotal = total - discount`.

### `PUT /bills/:id/payment`
Used for "Mark as Paid", "Record Payment" (partial payment), and adding/updating a
cheque number after a bill was created.
Request:
```json
{
  "paymentStatus": "paid | partial",
  "amountPaid": 0,
  "amountDue": 0,
  "paymentMethod": "cash | upi | cheque",
  "chequeNo": "string | undefined"
}
```
Response `200`.

Editing a bill's line items (via "Edit Items" on the bill detail page) is also replayed
as an `update` action on this endpoint, sending the full recomputed bill (items, totals,
and the recalculated payment figures). A backend can treat that as an idempotent upsert
of the bill; the frontend already adjusts local stock by the qty delta before syncing.

### `DELETE /bills/:id`
Response `204`. Exposed via the "Delete Bill" action on the bill detail page; deleting a
bill restores the stock its line items had consumed. Also replayed by the sync engine if a
delete was queued while offline.

## Notes for the backend implementation

- IDs are opaque strings — the frontend never assumes they're numeric, since offline-created
  records get a temporary `local-<timestamp>-<rand>` id that's swapped for the server's
  real id once the create syncs.
- `POST /items` and `POST /categories` should return the object with whatever id the
  server assigns; if it differs from what the client hasn't sent (it doesn't send one),
  that's expected — the client always lets the server assign ids on create.
- No pagination is assumed yet — `GET /items` and `GET /bills` return the full collection
  and the frontend caches it locally for instant, filterable reads.
