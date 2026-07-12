# Claude Code Prompt — Stationery Management App Frontend

Copy everything below into Claude Code as your starting prompt.

---

## Prompt

I want to build the frontend for a **Stationery Shop Management System** using **Ionic 8 + Angular 20 + Capacitor 8**. This app will run as a web app AND be packaged as an Android app using Capacitor. It will talk to a REST API hosted on my home server (I'll build the backend separately). Please scaffold and build the full frontend now.

### 1. Project Setup
- Create a new Ionic Angular project (standalone components, not NgModules) named `stationery-app`
- Use Angular routing with lazy-loaded feature pages
- Set up Capacitor for Android from the start
- Install and configure: `@ionic/angular`, `@angular/forms`, `@capacitor-community/sqlite` + `jeep-sqlite` (offline-first local database — see section 7), `@capacitor/preferences` (token storage), `@capacitor/network` (online/offline detection), `@capacitor-mlkit/barcode-scanning` + `@capacitor/camera` (QR/barcode scanning), `pdfmake` + `@capacitor/share` (bill PDF generation & sharing), `jwt-decode`
- Set up an environment config (`environment.ts` / `environment.prod.ts`) with an `apiUrl` variable so I can point to my home server URL (e.g. `https://mystore.duckdns.org/api`)
- Set up an `HttpInterceptor` that attaches a JWT token (from storage) to every API request, and redirects to login on 401 responses

### 2. Data Models (TypeScript interfaces)
Create interfaces matching this schema:
- `Category { id, name }`
- `Item { id, name, categoryId, category?, purchasePrice, sellingPrice, stockQty, unit, sku?, godownLocation? }`
- `BillItem { itemId, itemName, qty, price, subtotal, discount }` — discount is applied per line item (amount or %, converted to a monetary value), not just as a single bill-wide figure
- `Bill { id, billNo, customerName, customerPhone?, date, items: BillItem[], discount, total, grandTotal, paymentStatus ('paid' | 'pending' | 'partial'), amountPaid, amountDue, paymentMethod? ('cash' | 'upi' | 'cheque' | null), chequeNo? }` — `discount` is the sum of each line's discount, `total` is the sum of gross line subtotals, `grandTotal = total - discount`; `chequeNo` is an optional free-text field only meaningful when `paymentMethod` is `cheque` (and can be filled in after the bill is created)
- `User { id, name, role }`

### 3. Core Services (Angular injectable services, using HttpClient + RxJS)
- `AuthService` — login, signup, logout, token storage via Capacitor Preferences, current user state (BehaviorSubject). Since there's no backend yet, accounts are validated against a local SQLite `auth_users` table (seeded with `admin`/`admin123`, passwords SHA-256 hashed); a username not found locally falls through to a real `POST /auth/login` call so this keeps working once a backend exists
- `CategoryService` — CRUD for categories
- `ItemService` — CRUD for items, search/filter by name or category, low-stock query
- `BillingService` — create bill, get bill by id, list bills with date filter, get today's sales summary, list bills by payment status (paid/pending/partial), mark a pending bill as paid, record partial payment
- `SyncService` — detects offline state via `@capacitor/network`, queues billing actions locally when offline, syncs when back online

### 4. Pages / Screens (all standalone Ionic components)

**Auth**
- Login page (username/password, calls AuthService)
- Signup page (name/username/password, creates a local on-device account and signs
  the user straight in — see note in section 3 on local-first auth)

**Dashboard**
- Today's sales total, bill count, low-stock item alerts, quick action buttons (New Bill, Add Item)
- "Pending Payments" card — shows total amount due and number of pending/partial bills, tap to go straight to the Pending Bills page

**Categories**
- List of categories with item counts
- Add/Edit category modal (name field only)
- Delete with confirmation alert

**Items**
- List of items with search bar, category filter chips, stock badges (red if low stock)
- Add/Edit item form: name, category (select dropdown from CategoryService), purchase price, selling price, stock quantity, unit (dropdown: pcs, box, dozen, pack), SKU (optional, with a QR/barcode scan button beside it to capture the code from the camera), **godown location** (text field, e.g. "Rack 3, Shelf B" or "Godown 2 - Corner" — free text so it's flexible to however the shop organizes storage)
- Item detail view — show godown location prominently so staff can quickly find the item physically
- Search bar should also match against godown location (e.g. searching "Rack 3" shows all items stored there)

**Billing (most important screen)**
- Item search/autocomplete that adds items to a cart list, plus a QR/barcode scan button
  beside the search bar: scanning a product's SKU/QR looks the item up and adds it to the
  cart in one action (camera scan on Android via `@capacitor-mlkit/barcode-scanning`, with
  a "choose from gallery" image fallback on web)
- Cart shows: item name, qty (with +/- steppers **and** a directly-editable number field so
  large quantities don't need many taps), price, subtotal, remove button
- Customer name input (recommended, becomes required if marking bill as pending — need a way to identify who owes money) + optional customer phone number
- Discount input (amount or %)
- Auto-calculated total and grand total
- **Payment section** at the bottom of the cart, before generating:
  - Payment status choice: `ion-segment` with three options — **Paid**, **Pending**, **Partial**
  - If **Paid**: show payment method selector (Cash / UPI / Cheque — choosing Cheque reveals an optional Cheque No. field), amountPaid = grandTotal, amountDue = 0
  - If **Pending**: amountPaid = 0, amountDue = grandTotal, customer name/phone required
  - If **Partial**: input field for amount received now, amountDue auto-calculated as remainder, customer name/phone required
- "Generate Bill" button → saves bill (with paymentStatus, amountPaid, amountDue) via BillingService, reduces stock, shows success + bill preview
- After generating, show a printable/shareable bill view (use `pdfmake` to generate a PDF; use Capacitor Share API to share/print on Android) — the PDF should clearly show "PAID" or "DUE: ₹X" on it if not fully paid

**Pending Bills button**
- Prominent button/tab (with a badge showing count) accessible from the Billing screen and Dashboard, e.g. "Pending Bills (5)"
- Opens a **Pending Bills** page showing all bills where `paymentStatus` is `pending` or `partial`
- Each row shows: customer name, phone, bill no, date, grand total, amount due, days since bill
- Sort by oldest-due first by default; filter by customer name
- Tap a bill to view full detail, with a **"Mark as Paid"** button (or "Record Payment" for partial) that updates `paymentStatus` to `paid`, sets `amountDue` to 0, and logs `paymentMethod` — this update goes through the same offline sync queue as everything else, so it works with no internet too
- Show a running total at the top: "Total pending: ₹X across N bills"

**Bill History**
- List of past bills with date filter and a payment-status filter chip (All / Paid / Pending / Partial), tap to view bill detail/reprint
- Pending/partial bills shown with a colored badge (e.g. orange "DUE ₹X") so they stand out at a glance

**Reports** (simple)
- A Last 7 Days / Last 30 Days toggle that scopes the whole page
- Daily sales chart (lightweight custom bar chart rather than a heavy charting dependency)
- Top Selling and Low Selling item lists (by revenue in the selected period)
- Low stock report list (a live snapshot of current stock, independent of the date range)

### 5. Navigation & Layout
- Use Ionic's `ion-tabs` for main navigation: Dashboard, Items, Billing, Reports, Bills (bill history)
- Categories accessible from Items page (segmented view or side menu)
- Use `ion-menu` (side menu) for Categories, Settings, and Logout

### 6. UI/UX requirements
- Clean, professional look suitable for a retail counter — large tap targets for billing screen since it'll be used quickly
- Use Ionic's built-in components: `ion-searchbar`, `ion-list`, `ion-item-sliding` (for swipe-to-delete on items/categories), `ion-modal`, `ion-toast` for success/error messages, `ion-skeleton-text` for loading states
- Support both light and dark mode using Ionic CSS variables
- Mobile-first responsive layout, but should also look good on desktop browser (web deployment)

### 7. Offline-First Data & Sync (important — build this carefully)

The home server may go offline (power cut, internet down, router restart). The app must **never block the user** — everything should work fully offline using local cache, then sync automatically once the connection returns.

Build a proper **local-first sync system**, not just a cache:

**Local storage**
- Use `@capacitor-community/sqlite` (preferred over Preferences here, since we need to query/filter items and bills locally, not just store blobs)
- Mirror the same tables locally as on the server: `categories`, `items`, `bills`, `bill_items`
- On every successful API fetch (items, categories, bills), overwrite the local SQLite cache with the latest server data
- All reads (item list, category list, dashboard, billing search) should always read from local SQLite first, so the UI is instant and works with zero internet

**Write queue (for offline changes)**
- Add a `sync_queue` table locally: `id, entity_type (item/category/bill), action (create/update/delete), payload (JSON), status (pending/synced/failed), created_at`
- Any create/update/delete action (new bill, new item, edited category, stock change, etc.) does two things immediately:
  1. Applies the change to local SQLite right away, so the UI updates instantly regardless of internet
  2. Adds a row to `sync_queue` with status `pending`
- A **new bill generated offline** gets a temporary local ID (e.g. `local-<timestamp>`) so billing/printing works immediately; it gets replaced with the real server ID once synced

**SyncService (background sync engine)**
- Use `@capacitor/network` to listen for connection changes (`Network.addListener('networkStatusChange', ...)`)
- When the app detects internet is back:
  1. Read all `pending` rows from `sync_queue`, oldest first
  2. Send each to the backend API in order
  3. On success: mark that row `synced`, update the local record's real server ID if it was a create
  4. On failure (server reachable but rejects, e.g. validation error): mark `failed` and keep it for manual review, don't block the rest of the queue
- Also run this sync check automatically: on app startup, on app resume (`App.addListener('resume', ...)`), and every ~30 seconds while online, in case something was missed
- If two devices edited the same item while both offline (rare but possible), last-synced-write wins — flag this as a known limitation in code comments; don't over-engineer conflict resolution for v1

**UI feedback**
- Persistent banner/badge when offline: "Offline — changes will sync when internet is back"
- Small sync status icon (e.g. cloud with checkmark / cloud with spinner / cloud with warning) showing: all synced / syncing now / N items pending / sync failed
- On the Bill History and Items list, mark any not-yet-synced records with a small "pending sync" tag so the shop owner knows that bill/item hasn't reached the server yet

This means: if the home server or internet drops for hours, the shop can keep billing customers and adding items normally on the tablet/phone, and everything quietly uploads once connectivity returns — no data loss, no blocking.

### 8. Forms & Validation
- Use Angular Reactive Forms for all Add/Edit forms
- Validate: required fields, prices must be positive numbers, stock quantity can't go negative

### 9. Final steps
- Add a `README.md` explaining how to run it (`ionic serve`), how to build for Android (`ionic build && npx cap sync android && npx cap open android`), and where to set the `apiUrl`
- Keep the API contract assumptions documented clearly in a `API_CONTRACT.md` file (list expected endpoints like `GET /api/items`, `POST /api/bills`, etc.) so I can build a matching backend afterward

Build this step by step: scaffold project → models/services → auth → categories → items → billing → history/reports → offline sync → polish UI. Show me progress after each major step rather than doing everything silently.

---

### Notes before you run this
- Have Node.js and the Ionic CLI installed (`npm install -g @ionic/cli`) before starting
- Decide your home server's domain (via DuckDNS or Cloudflare Tunnel) ahead of time so you can plug it into `environment.ts`
- If you want offline billing to be robust, consider asking Claude Code to use `@capacitor-community/sqlite` instead of Preferences — mention that upfront if you want it


hi