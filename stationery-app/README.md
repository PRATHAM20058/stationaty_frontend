# Stationery Shop Management App — Frontend

Ionic 8 + Angular 20 (standalone components) + Capacitor 8 frontend for a stationery shop
management system. Works as a web app and as an Android app, with a full offline-first
local cache + sync queue backed by SQLite so billing keeps working even when the home
server is unreachable.

## Key features

- **Billing / POS** — search or browse-by-category to build a cart, per-line discounts
  (₹ or %), directly-editable quantities (type a number instead of tapping +/-), and a
  Paid / Pending / Partial payment flow.
- **QR / barcode scan-to-cart** — a scan button beside the Billing search bar (and beside
  the SKU field on the Item form) opens a camera scanner; scanning a product's SKU/QR
  looks the item up and adds it straight to the cart. Backed by
  `@capacitor-mlkit/barcode-scanning` with a "choose from gallery" fallback.
- **Payment methods** — Cash, UPI, or Cheque. Choosing Cheque reveals an optional
  Cheque No. field that can also be added/edited later from the bill's detail page.
- **Items & inventory** — CRUD with category filter, low-stock badges, SKU, and a free-text
  godown/storage location that search also matches against.
- **Bills** — history with date + status filters, per-bill detail with edit-items,
  record-payment, share/print PDF, and delete.
- **Reports** — daily sales chart plus Top Selling, Low Selling, and Low Stock lists,
  scoped by a Last 7 Days / Last 30 Days toggle.
- **Offline-first** — every read is served from a local SQLite cache and every write is
  queued and replayed to the backend when connectivity returns (see below).
- Company name + GSTIN (set in the environment files) are printed on every generated bill.

## Requirements

- Node.js 20+ and npm (required by Angular 20)
- Ionic CLI: `npm install -g @ionic/cli`
- For Android builds: Android Studio / Android SDK, a JDK (21 is required by some
  Capacitor plugins — see Troubleshooting below), and an emulator or device

## Setup

```bash
npm install
```

## Running as a web app

```bash
ionic serve
```

Opens the app at `http://localhost:8100`. On web, the local database is backed by
`jeep-sqlite` (a wasm SQLite running over IndexedDB), so offline-first behavior works
in the browser too.

## Pointing at your backend

Set the API base URL in:

- `src/environments/environment.ts` — used by `ionic serve` / dev builds
- `src/environments/environment.prod.ts` — used by production builds (`ionic build --prod`,
  and therefore the Android app)

```ts
export const environment = {
  production: true,
  apiUrl: 'https://mystore.duckdns.org/api',
  lowStockThreshold: 5,
  // Printed on every bill / invoice PDF.
  company: {
    name: 'Shree Sales Agency',
    gstNo: '24AABCS1234K1Z9',
  },
};
```

See `API_CONTRACT.md` for the endpoints the app expects the backend to expose, and
`BACKEND_PROMPT.md` for a full build-ready spec of the backend itself (Node.js + Express +
Homebrew MySQL — schema, auth, business rules, and an acceptance checklist).

> **Note:** QR/barcode scanning uses the device camera and only runs on the Android app.
> On the web build, the scanner modal falls back to a "choose from gallery" image scan.

## Building for Android

```bash
ionic build
npx cap sync android
npx cap open android   # opens Android Studio, or build/run from the CLI below
```

To build and install a debug APK from the CLI instead of Android Studio:

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.mystore.stationery/.MainActivity
```

For a signed **release** APK (release signing is already configured in
`android/app/build.gradle` against the bundled `stationery-release.jks` keystore):

```bash
ionic build --prod
npx cap sync android
cd android
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk  (installable, signed)
```

The app id is `com.mystore.stationery`.

### Troubleshooting: Gradle can't find a JDK 21

`@capacitor/filesystem`'s Android module requires Java 21. If Gradle reports it can't find
a matching toolchain, install Temurin 21 and point Gradle at it for the build:

```bash
brew install --cask temurin@21
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

## Project structure

```
src/app/
  core/
    models/        # Category, Item, Bill, User, sync types
    services/       # Auth, UserStore, DemoSeed, Category, Item, Billing, Sync,
                     # Sqlite, Pdf, SyncTrigger
    interceptors/    # JWT attach + 401 -> logout/login redirect
    guards/          # authGuard for protected routes
  pages/
    login, signup, dashboard, categories, items (+ item-form, item-detail),
    billing, bill-detail, pending-bills, bill-history, reports, settings
  shared/
    components/ # offline-banner, sync-status, payment-modal, barcode-scanner-modal
    directives/  # enter-next, form-navigation, select-typeahead
  tabs/          # bottom tab navigation (Dashboard / Items / Billing / Reports / Bills)
```

Dashboard, Items, Billing, Reports, and Bills (bill history) are the bottom tabs.
Categories and Settings — plus Logout — are reachable from the side menu (`ion-menu`).

## Offline-first behavior

- All reads (items, categories, bills, dashboard, billing search) come from a local
  SQLite cache first, so the UI is instant and fully usable offline.
- Every create/update/delete writes to SQLite immediately and queues a row in a local
  `sync_queue` table.
- `SyncService` drains that queue whenever the app is online — on network reconnect,
  on app resume, every ~30s, and immediately after any write — replaying queued
  actions to the backend in order.
- A yellow "Offline" banner and a small cloud icon (synced / syncing / N pending / failed)
  reflect current sync status; not-yet-synced bills/items show a "Pending sync" tag.
- **Known limitation (v1):** if the same record is edited on two offline devices before
  either syncs, last-synced-write wins. There's no merge/conflict resolution.

## Login

There's no backend yet, so auth runs entirely on-device: accounts live in a local
SQLite `auth_users` table, seeded on first launch with `admin` / `admin123`. New
accounts can also be created from the **Sign Up** page (`/signup`), which creates a
local account and signs you straight in — no server call involved.

`POST /auth/login` is only called as a fallback when a username isn't found locally,
so it will fail until you build a backend matching `API_CONTRACT.md` (see `BACKEND_PROMPT.md`
for a ready-to-build spec). Once one exists,
logging in with a username that isn't a local account will hit it transparently.
Everything else in the app (browsing cached items, offline billing, etc.) is designed
to keep working regardless of backend availability once a session exists.
