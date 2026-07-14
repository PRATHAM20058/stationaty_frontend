# API Contract

This document is the transport-level contract: the exact endpoints, request/response shapes,
and status codes the frontend already calls. For a full, build-ready backend spec (Node.js +
Express + Homebrew MySQL — schema DDL, auth/seeding, business rules, project layout, acceptance
checklist), see **`BACKEND_PROMPT.md`**, which is written to be handed straight to an AI assistant
or followed by hand. If the two ever disagree, this file (what the client actually sends/expects)
is authoritative.

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
  "godownLocation": "string | null",
  "hsnCode": "string | null",
  "gstPercent": "number | null  // one of 0, 5, 12, 18, 28"
}]
```

`hsnCode` and `gstPercent` are **optional, additive** GST fields (nullable, default `NULL`).
Legacy items without them behave exactly as before.

### `POST /items`
Request body: item fields minus `id` (now including the optional `hsnCode` / `gstPercent`).
Response `201`: full item including server-assigned `id`.

### `PUT /items/:id`
Request body: item fields minus `id` (full replace, including `stockQty` — the app
sends the item's new absolute stock quantity after billing reduces it, not a delta — and
the optional `hsnCode` / `gstPercent`).
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
  "items": [{
    "itemId": "string", "itemName": "string", "qty": 0, "price": 0, "subtotal": 0, "discount": 0,
    "hsnCode": "string | null", "gstPercent": 0, "taxableValue": 0, "sgst": 0, "cgst": 0, "igst": 0
  }],
  "discount": 0,
  "total": 0,
  "grandTotal": 0,
  "paymentStatus": "paid | pending | partial",
  "amountPaid": 0,
  "amountDue": 0,
  "paymentMethod": "cash | upi | cheque | null",
  "chequeNo": "string | undefined (only meaningful when paymentMethod is 'cheque'; optional, may be added after the bill is created)",

  "isGstInvoice": false,
  "gstType": "intra | inter | none",
  "sellerGstin": "string | undefined",
  "sellerStateCode": "string | undefined",
  "buyerGstin": "string | null",
  "buyerState": "string | null",
  "buyerStateCode": "string | null",
  "taxableAmount": 0,
  "sgstTotal": 0,
  "cgstTotal": 0,
  "igstTotal": 0,
  "roundOff": 0,
  "amountInWords": "string | undefined"
}]
```

All the GST fields above (line-level and bill-level) are **optional and additive**
(nullable / defaulted to `0` / `false` / `"none"`). For a non-GST bill every tax and
`roundOff` is `0`, `gstType` is `"none"`, and `grandTotal` still equals `total - discount`.
When `isGstInvoice` is true, `grandTotal = taxableAmount + sgstTotal + cgstTotal + igstTotal
+ roundOff` (rounded to the nearest rupee, the difference captured in `roundOff`). The server
should persist-and-echo whatever GST columns it stores and ignore any it doesn't yet — the
contract stays backward compatible.

### `POST /bills`
Request body: the full bill object (including the additive GST fields above). The app
generates a temporary `billNo` (`BILL-<timestamp>`) and `id` (`local-<ts>-<rand>`) locally
(offline or not) and includes them, but the server should **ignore** them and assign its own;
the server's response values replace them once synced.
Response `201`: full bill including the server-assigned `id` and a plain, sequential
**8-digit** `billNo` (`00000001`, `00000002`, … — per-user numbering).

**Do not decrement item stock on this endpoint.** Stock is client-authoritative: when a
bill is created the app also queues a `PUT /items/:id` for each line carrying the new
**absolute** `stockQty`, so the item update already reflects the sale. Decrementing again
on the bill create would double-count. (Same for `DELETE /bills/:id` — see below.)

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
the recalculated payment figures, and the recomputed GST fields). A backend can treat that
as an idempotent upsert of the bill; the frontend already adjusts local stock by the qty
delta before syncing.

### `DELETE /bills/:id`
Response `204`. Exposed via the "Delete Bill" action on the bill detail page. Also replayed
by the sync engine if a delete was queued while offline. As with create, **do not restore
item stock here** — the app already queues `PUT /items/:id` updates with the restored
absolute `stockQty` for each line, so restoring server-side too would double-count.

## Notes for the backend implementation

- IDs are opaque strings — the frontend never assumes they're numeric, since offline-created
  records get a temporary `local-<timestamp>-<rand>` id that's swapped for the server's
  real id once the create syncs.
- `POST /items` and `POST /categories` should return the object with whatever id the
  server assigns; if it differs from what the client hasn't sent (it doesn't send one),
  that's expected — the client always lets the server assign ids on create.
- No pagination is assumed yet — `GET /items` and `GET /bills` return the full collection
  and the frontend caches it locally for instant, filterable reads.
