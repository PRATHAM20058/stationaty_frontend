# Stationery Shop Management System — Technical Documentation Index

Welcome to the technical documentation repository for the **Stationery Shop Management & Point-of-Sale (POS)** application. This documentation suite is organized for developers, software architects, and DevOps engineers maintaining or extending the codebase.

---

## 1. Executive Summary

The **Stationery Shop Management System** is an offline-first, multi-platform retail point-of-sale and inventory management application. Built primarily with **Ionic 8**, **Angular 20** (Standalone Components), and **Capacitor 8**, it deploys as both a native Android application and a Progressive Web App (PWA).

The system addresses retail counter challenges where network connectivity is intermittent, erratic, or entirely absent. Operations such as product lookups, barcode scanning, cart updates, and bill generations occur locally with **zero network latency** backed by local SQLite. Transactions and inventory updates synchronize asynchronously with a central **Node.js/Express + MySQL 8** backend once connectivity is restored.

---

## 2. Technical Stack Matrix

| Domain | Technology / Library | Version / Details | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | Angular | 20.3.x (Standalone Components) | Core application framework; signals, reactive forms, routing |
| **Mobile UI Library** | Ionic Framework | 8.0.x (`@ionic/angular`) | Mobile-first UI components, Material Design 3 (`mode: 'md'`) |
| **Native Bridge** | Capacitor | 8.4.x (`@capacitor/core`, Android) | Native platform runtime and plugin bridge |
| **Mobile Local DB** | `@capacitor-community/sqlite` | 8.1.x | On-device persistent SQLite engine (Android/iOS) |
| **Web Local DB** | `jeep-sqlite` + `sql.js` (WASM) | 2.8.0 / 1.11.0 | In-browser SQLite WebAssembly backed by IndexedDB |
| **Barcode Scanning** | `@capacitor-mlkit/barcode-scanning` | 8.1.x | Google ML Kit on-device camera barcode recognition |
| **Camera & Gallery** | `@capacitor/camera` | 8.2.x | Image capture & photo picker for barcode fallback |
| **PDF Generation** | `pdfmake` | 0.3.x | Client-side vector PDF generation (Receipts & GST Invoices) |
| **Native Sharing** | `@capacitor/share` + `filesystem` | 8.x | Native OS share sheet & file persistence |
| **Data Import/Export** | `xlsx` (SheetJS) | 0.18.x | Excel spreadsheet workbook parser & template creator |
| **Backend Runtime** | Node.js | 20.x LTS / 22.x+ | Server execution environment |
| **Backend API** | Express.js | 4.19.x | REST API router and middleware stack |
| **Database Driver** | `mysql2` | 3.11.x | Connection pooling and Promise-based SQL execution |
| **Database Engine** | MySQL | 8.0+ | Multi-tenant persistent relational store |
| **Security & Auth** | `jsonwebtoken` + `bcryptjs` | 9.0.x / 2.4.x | Stateless JWT authentication and password hashing |

---

## 3. Documentation Structure

This `Production/` folder contains comprehensive technical specifications categorized by architectural subsystem:

```
stationery-app/Production/
├── README.md                           # Master Index, System Overview & Tech Stack (This file)
├── 01_ARCHITECTURE_AND_OFFLINE_SYNC.md # Local-first SQLite, sync queue, ID remapping & lifecycles
├── 02_BACKEND_API_AND_DATABASE.md      # Express server, MySQL schema, REST endpoints & archival logic
├── 03_GST_ENGINE_AND_INVOICING.md      # Indian GST calculations, HSN splits, round-off & PDF rendering
├── 04_FRONTEND_MODULES_AND_UI.md       # Angular services, reactive forms, POS workflow & barcode scanning
├── 05_DEPLOYMENT_AND_OPERATIONS.md     # Build pipelines, Android packaging, Linux services & CGNAT tunnels
└── 06_MACBOOK_AND_ANDROID_STUDIO_GUIDE.md # Local MacBook setup, Homebrew MySQL & Android Studio (Pixel 6 API 33)
```

### Detailed Document Outlines:

1. [**01_ARCHITECTURE_AND_OFFLINE_SYNC.md**](./01_ARCHITECTURE_AND_OFFLINE_SYNC.md)
   - Dual-engine SQLite strategy (native `@capacitor-community/sqlite` vs web `jeep-sqlite` WASM).
   - Write-ahead offline queue architecture (`sync_queue` table).
   - Temporary ID and placeholder bill number mechanics (`local-<timestamp>-<rand>` & `BILL-<timestamp>`).
   - ID remapping engine: cascading foreign key translations on category/item creates.
   - Network state monitoring and background sync triggers (startup, resume, interval, write-through).
   - Multi-tenant data segregation and cache cleanup lifecycle.

2. [**02_BACKEND_API_AND_DATABASE.md**](./02_BACKEND_API_AND_DATABASE.md)
   - MySQL 8.0 relational schema: `auth_users`, `categories`, `items`, `bills`, `bill_items`.
   - Transactional soft-delete archival tables: `deleted_bills` and `deleted_bill_items`.
   - Complete HTTP REST API contract: Request/Response bodies, status codes, query parameters.
   - Multi-tenant query scoping via JWT claim (`req.user.id`).
   - The **Client-Authoritative Stock Invariant** (preventing inventory double-counting).
   - Sequential 8-digit invoice numbering algorithm (`nextBillNo`).

3. [**03_GST_ENGINE_AND_INVOICING.md**](./03_GST_ENGINE_AND_INVOICING.md)
   - Indian Goods and Services Tax (GST) mathematical model.
   - Intra-state (SGST + CGST) vs Inter-state (IGST) determination rules.
   - Line-item discount handling and taxable value computations (`taxableValue = subtotal - discount`).
   - Precision rounding, integer-paise math, and signed round-off tracking.
   - Indian numbering system words converter (`numberToWordsIndian` supporting Lakhs & Crores).
   - `PdfService` specification: thermal receipt layout vs bordered A4 legal tax invoice.

4. [**04_FRONTEND_MODULES_AND_UI.md**](./04_FRONTEND_MODULES_AND_UI.md)
   - Angular 20 standalone architecture, routing hierarchy, and lazy loading.
   - Core services breakdown: `BillingService`, `ItemService`, `CategoryService`, `AuthService`.
   - Keyboard-friendly POS UI: `appEnterNext` and typeahead directives.
   - Camera barcode scanner modal and gallery fallback flow.
   - Bulk inventory onboarding via Excel (`.xlsx`) parser and canonical header mapping.
   - Payment lifecycle: Paid, Pending, and Partial payment handling with Cheque support.

5. [**05_DEPLOYMENT_AND_OPERATIONS.md**](./05_DEPLOYMENT_AND_OPERATIONS.md)
   - Local development instructions for Web and Android.
   - Building and signing Android APKs via Gradle and Capacitor.
   - Linux Lite / Ubuntu 24x7 home server deployment with `systemd` and `deploy-linux.sh`.
   - Networking strategies: LAN HTTP (Option A) vs DuckDNS/Caddy HTTPS (Option B).
   - Operating behind ISP Carrier-Grade NAT (CGNAT) via Tailscale Funnel and Cloudflare Tunnels.
   - Operational runbooks, database backup commands, and troubleshooting guides.

6. [**06_MACBOOK_AND_ANDROID_STUDIO_GUIDE.md**](./06_MACBOOK_AND_ANDROID_STUDIO_GUIDE.md)
   - Step-by-step setup on macOS: Homebrew MySQL 8, Node 20+, and Temurin JDK 21.
   - Backend bootstrapping: `./setup-db.sh`, `npm run seed`, and `npm run dev`.
   - **Pixel 6 API 33 Emulator Networking**: Using the `http://10.0.2.2:3000/api` gateway to reach host MacBook.
   - Launching via Android Studio GUI (`npx cap open android`) or Command Line CLI (`emulator -avd Pixel_6`).
   - Offline mode verification, camera barcode scanner simulation, and troubleshooting runbook.

---

## 4. Architectural Highlights & Invariants

When working on this codebase, developers must adhere to the following architectural rules:

1. **Never mutate stock on bill operations on the backend**:
   The frontend is the single source of truth for inventory decrements and increments. Creating a bill generates a `POST /bills` request *and* individual `PUT /items/:id` requests containing absolute `stockQty` values. If the backend decrements stock on `POST /bills`, stock will be deducted twice.
2. **All client reads hit local SQLite first**:
   Components should never subscribe directly to remote HTTP `GET` requests for view rendering. Views query `SqliteService`, ensuring instant loading and complete offline functionality. Remote `refreshFromServer()` calls overwrite the local SQLite cache in the background.
3. **Session boundary wipes local cache**:
   Because SQLite stores multi-tenant shop data locally on the device, logging in or out calls `sqlite.clearUserData()`. This drops cached categories, items, bills, and sync queue records so accounts on shared hardware never cross-contaminate.
