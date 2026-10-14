# Subsystem Architecture: Frontend Modules, POS & UI

This document details the Angular 20 standalone architecture, Ionic 8 navigation lifecycle, Point-of-Sale (POS) counter interface, ML Kit barcode scanning, Excel bulk inventory import, and keyboard ergonomics.

---

## 1. Angular Standalone Architecture & Routing Tree

The application is built entirely using **Angular 20 Standalone Components** (`imports: [...]`), eliminating NgModule boilerplate.

### Routing Hierarchy

```
app.routes.ts
├── /login                   ── LoginPage (Public)
├── /signup                  ── SignupPage (Public)
├── / (Protected)            ── authGuard
│   ├── /tabs (TabsPage)
│   │   ├── /dashboard       ── DashboardPage
│   │   ├── /items           ── ItemsPage
│   │   ├── /billing         ── BillingPage (Main POS)
│   │   ├── /reports         ── ReportsPage
│   │   └── /bill-history    ── BillHistoryPage
│   ├── /categories          ── CategoriesPage
│   ├── /items/new           ── ItemFormPage
│   ├── /items/:id/edit      ── ItemFormPage
│   ├── /items/:id           ── ItemDetailPage
│   ├── /pending-bills       ── PendingBillsPage
│   ├── /bills/:id           ── BillDetailPage
│   └── /settings            ── SettingsPage
```

### Material Design 3 Enforcement
In [**`src/main.ts`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/main.ts), Ionic is explicitly initialized with:
```typescript
provideIonicAngular({ mode: 'md' })
```
This forces Material Design 3 tokens and ripple effects across all target platforms (including iOS and Desktop Web), ensuring uniform tap targets, elevation, and typography across devices.

---

## 2. POS Counter Workflow (`BillingPage`)

[**`BillingPage`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/pages/billing/billing.page.ts) is the core operational screen, optimized for rapid retail checkout:

```
┌────────────────────────────────────────────────────────┐
│  Search Products / SKU / Godown          [📷 Barcode]  │
├────────────────────────────────────────────────────────┤
│  Category Quick-Picks: [All] [Pens] [Notebooks] [...]   │
├────────────────────────────────────────────────────────┤
│  Cart List:                                            │
│  - Line 1: A4 Notebook 200pg   Qty: [ 5 ]  ₹60  ₹300   │
│    Discount: [ ₹10 / 5% ]               [Delete]       │
│  - Line 2: Blue Ball Pen (box) Qty: [ 2 ]  ₹90  ₹180   │
├────────────────────────────────────────────────────────┤
│  [Toggle] GST Invoice  (Buyer GSTIN / State Code)      │
├────────────────────────────────────────────────────────┤
│  Totals: Gross: ₹480 | Disc: ₹10 | Grand: ₹470.00      │
│  Payment: [ Paid ] [ Partial ] [ Pending ]             │
│  Method:  (o) Cash   ( ) UPI   ( ) Cheque [# Cheque]   │
│  Customer: [ Name * ] [ Mobile ]                       │
├────────────────────────────────────────────────────────┤
│  [ GENERATE BILL & PRINT INVOICE ]                     │
└────────────────────────────────────────────────────────┘
```

### Ergonomic POS Capabilities:
1. **Direct Quantity Input**:
   In addition to standard stepper buttons (`+` / `-`), the quantity field is a direct numeric `<ion-input>` so staff selling large wholesale quantities (e.g., 50 boxes) type the number in one stroke rather than tapping 50 times.
2. **Per-Line Flexible Discounts**:
   Discounts are applied per line item rather than as an imprecise bill-wide discount. Each line toggles between a flat rupee reduction (`₹`) or a percentage (`%`), automatically recalculated to monetary values.
3. **Category Browse & Auto-Cart**:
   Tapping a category chip filters available items. Tapping an item adds it to the cart immediately or increments quantity if already present.
4. **Payment State Validation**:
   - **Paid**: `amountPaid = grandTotal`, `amountDue = 0`.
   - **Pending**: `amountPaid = 0`, `amountDue = grandTotal`. Customer Name becomes strictly required.
   - **Partial**: Reveals `partialAmountReceived` input. Remainder is calculated in real time as `amountDue`. Customer Name becomes required.
   - **Cheque Payment**: Selecting `'cheque'` reveals an optional `chequeNo` input, editable now or later from Bill Details.

---

## 3. Barcode & QR Code Scanner Integration

The barcode scanning system enables instant scan-to-cart operations and SKU capture in the Item form.

### Implementation Stack
- Component: [**`BarcodeScannerModalComponent`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/shared/components/barcode-scanner-modal/barcode-scanner-modal.component.ts)
- Engine: `@capacitor-mlkit/barcode-scanning` (Google ML Kit on-device model)
- Fallback: `@capacitor/camera` (Photo gallery picker)

### Supported Formats
Scans all standard retail 1D/2D symbologies:
`Ean13`, `Ean8`, `UpcA`, `UpcE`, `Code128`, `Code39`, `Itf`, and `QrCode`.

### The Transparent WebView Technique
ML Kit renders the camera preview directly on the Android hardware layer **behind** the webview. To allow the user to see the camera feed:
1. The scanner triggers:
   ```typescript
   document.body.classList.add('barcode-scanner-active');
   ```
2. In [**`src/global.scss`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/global.scss), the CSS enforces total transparency on the DOM:
   ```scss
   body.barcode-scanner-active {
     --ion-background-color: transparent !important;
     background: transparent !important;
     ion-app, ion-content {
       --background: transparent !important;
       background: transparent !important;
     }
   }
   ```
3. A viewfinder overlay with an alignment reticle is drawn via SVG over the transparent hole.
4. On detection or cancel, `barcode-scanner-active` is removed, restoring normal background colors.

### Web Browser Fallback
In desktop browsers where camera hardware ML Kit is unavailable, the modal detects `Capacitor.getPlatform() === 'web'` and guides the user to the **"Choose from Gallery"** button. The file is read as a Blob and passed to `BarcodeScanner.readBarcodesFromImage({ blob })`.

---

## 4. Bulk Inventory Onboarding (`ItemImportService`)

Retail shops moving from legacy billing software or physical ledgers often possess hundreds of inventory SKUs in Excel spreadsheets.

### Architecture
- Service: [**`ItemImportService`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/item-import.service.ts)
- Engine: SheetJS (`xlsx`) loaded via dynamic chunk `await import('xlsx')` so initial bundle size is unaffected.

### Pipeline:
1. **Header Normalization**:
   Spreadsheet headers are trimmed, lowercased, and mapped via `HEADER_MAP`. It recognizes varied header styles:
   - Name: `name`, `item`, `productname`, `product`
   - Price: `sellingprice`, `rate`, `mrp`, `price`
   - Stock: `stockqty`, `quantity`, `qty`, `stock`
   - Location: `godownlocation`, `godown`, `rack`, `location`
2. **Dynamic Category Resolution**:
   If a row specifies a category name that does not exist in local SQLite, `CategoryService.create()` is automatically invoked to provision the category on the fly.
3. **Template Export**:
   `downloadTemplate()` generates a ready-to-fill `.xlsx` with sample data:
   - On Web: Uses `XLSX.writeFile()` to trigger a browser file download.
   - On Android: Encodes workbook to base64, saves to `Directory.Cache` via `@capacitor/filesystem`, and presents the file via `@capacitor/share`.

---

## 5. Keyboard Ergonomics & Counter Directives

At physical POS billing desks, operators prefer typing without reaching for a touch screen or mouse.

### `appEnterNext` Directive
Implemented in [**`EnterNextDirective`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/shared/directives/enter-next.directive.ts):
- Attached to `<ion-input>`, `<ion-textarea>`, and `<ion-select>`.
- Intercepts `keydown.enter`, prevents form submission, and calculates the next logical form control via DOM traversal:
  ```typescript
  export async function focusNextField(currentEl: HTMLElement): Promise<void> {
    const form = currentEl.closest('form');
    // Finds visible, enabled input/select/button elements in form
    // Automatically invokes .open() if the target is an <ion-select>
    // Submits form if the current field is the final field
  }
  ```

---

## 6. Real-Time View Invalidation Across Cached Tabs

Ionic maintains backgrounded tabs alive in the DOM for instant navigation. However, if a user generates a bill on the **Billing Tab**, the **Dashboard Tab** and **Reports Tab** must reflect the new sales metrics immediately upon being revisited.

To achieve this without costly polling:
1. **Observable Event Emitters**:
   - `BillingService.changes$` (`Subject<void>`) emits on bill creation, payment update, and deletion.
   - `ItemService.changes$` (`Subject<void>`) emits on stock adjustments and product edits.
2. **Lifecycle Subscriptions**:
   Pages subscribe using Angular's `takeUntilDestroyed(this.destroyRef)` inside `ngOnInit`:
   ```typescript
   this.billingService.changes$
     .pipe(takeUntilDestroyed(this.destroyRef))
     .subscribe(() => this.load());
   ```
   This ensures background tabs re-query their local SQLite database instantly whenever relevant data mutations occur anywhere in the system.
