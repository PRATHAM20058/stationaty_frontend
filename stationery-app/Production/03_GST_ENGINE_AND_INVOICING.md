# Subsystem Architecture: GST Invoicing & PDF Generation

This document details the mathematical model, legal compliance logic, Indian numbering algorithms, and PDF rendering engine for Goods and Services Tax (GST) invoices in the Stationery Shop application.

---

## 1. GST Regulatory Background & Tax Classifications

In India, GST is a dual-tier consumption tax levied on goods and services. The tax split depends on whether the transaction is within the same state (intra-state) or across state boundaries (inter-state):

```
                        Transaction Initiated
                                  │
                    Is `isGstInvoice` enabled?
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
                  No                            Yes
         (Simple Cash Bill)              (GST Tax Invoice)
         - All taxes = 0                         │
         - Grand Total = Total - Disc    Compare Buyer & Seller
         - Receipt PDF layout                  State Codes
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
               Buyer Code == Seller Code                        Buyer Code != Seller Code
                      (Intra-State)                                   (Inter-State)
             - CGST = (Rate / 2)%                            - IGST = Rate%
             - SGST = (Rate / 2)%                            - CGST = 0, SGST = 0
```

1. **Intra-State (`gstType === 'intra'`)**:
   - The seller's state code matches the buyer's state code (or the buyer code is left blank, defaulting to the seller's state code, e.g., `24` for Gujarat).
   - The GST percentage is divided equally into **Central GST (CGST)** and **State GST (SGST)**.
2. **Inter-State (`gstType === 'inter'`)**:
   - The buyer's state code differs from the seller's state code.
   - The entire tax is levied as **Integrated GST (IGST)**; CGST and SGST remain `0`.
3. **Non-GST Bill (`gstType === 'none'`)**:
   - `isGstInvoice` is false.
   - All tax fields, round-off amounts, and GST types remain `0` / `'none'`.
   - Backward-compatible: `grandTotal` equals `total - discount`.

---

## 2. Mathematical Model & Precision Engine

All calculation logic resides in the pure helper [**`stationery-app/src/app/core/utils/gst.util.ts`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/utils/gst.util.ts).

### Floating-Point Drift Mitigation (`round2`)
To avoid standard IEEE-754 binary floating-point drift (e.g., `0.1 + 0.2 = 0.30000000000000004`), calculations round intermediate and line values to 2 decimal places using `Number.EPSILON`:

```typescript
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
```

### Calculation Pipeline (`calcGstBill`)

```typescript
export function calcGstBill(bill: GstBillInput, seller: GstSellerInput): GstBillResult {
  // 1. Determine tax type
  const gstType: GstType = !bill.isGstInvoice
    ? 'none'
    : (bill.buyerStateCode ?? '') === seller.sellerStateCode
      ? 'intra'
      : 'inter';

  // 2. Compute per-line discount-net value and tax breakdown
  const lines: GstLineResult[] = bill.items.map((line) => {
    const gstPercent = gstType === 'none' ? 0 : Number(line.gstPercent) || 0;
    const taxableValue = round2(line.subtotal - line.discount);
    let sgst = 0;
    let cgst = 0;
    let igst = 0;

    if (gstType === 'intra') {
      sgst = cgst = round2((taxableValue * (gstPercent / 2)) / 100);
    } else if (gstType === 'inter') {
      igst = round2((taxableValue * gstPercent) / 100);
    }

    return { gstPercent, taxableValue, sgst, cgst, igst };
  });

  // 3. Accumulate ledger totals
  const taxableAmount = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));

  const raw = taxableAmount + sgstTotal + cgstTotal + igstTotal;

  // 4. Round to nearest integer rupee with signed round-off
  const grandTotal = gstType === 'none' ? round2(raw) : Math.round(raw);
  const roundOff = gstType === 'none' ? 0 : round2(grandTotal - raw);

  return {
    gstType,
    lines,
    taxableAmount,
    sgstTotal,
    cgstTotal,
    igstTotal,
    roundOff,
    grandTotal,
    amountInWords: numberToWordsIndian(grandTotal),
  };
}
```

### Rules & Invariants:
1. **Discount-Net Tax Base**:
   Taxes are never calculated on gross subtotal. Each line's discount is subtracted first:
   $$\text{taxableValue} = \text{round2}(\text{subtotal} - \text{discount})$$
2. **Signed Round-Off (`roundOff`)**:
   Under Indian tax laws, the final invoice payable is rounded to the nearest integer rupee ($\text{grandTotal} = \text{round}(\text{raw})$). The difference is tracked explicitly in a signed `roundOff` ledger field:
   $$\text{roundOff} = \text{round2}(\text{grandTotal} - \text{raw})$$
   *(Example: Raw ₹3,869.99 yields Grand Total ₹3,870.00 and Round Off +₹0.01).*

---

## 3. Indian Numbering System: Amount in Words

The legal requirements for tax invoices dictate that the final invoice figure must be printed in words using the Indian numbering system (**Lakhs** and **Crores** rather than Millions and Billions).

### Algorithm (`numberToWordsIndian`)
Implemented in `gst.util.ts`:
- **1 Crore** = 10,000,000 ($\ge 10^7$)
- **1 Lakh** = 100,000 ($\ge 10^5$)
- **1 Thousand** = 1,000 ($\ge 10^3$)
- **1 Hundred** = 100 ($\ge 10^2$)

```typescript
export function numberToWordsIndian(amount: number): string {
  const rounded = round2(amount);
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  const rupeeWords = rupees === 0 ? 'Zero' : integerToWords(rupees);
  const paiseSuffix = paise > 0 ? ` and ${twoDigitWords(paise)} Paise` : '';
  return `${rupeeWords} Rs${paiseSuffix} only`;
}
```

**Output Examples**:
- `3870` $\rightarrow$ `"Three thousand Eight hundred Seventy Rs only"`
- `125000` $\rightarrow$ `"One lakh Twenty Five thousand Rs only"`
- `10000000` $\rightarrow$ `"One crore Rs only"`
- `1234.50` $\rightarrow$ `"One thousand Two hundred Thirty Four Rs and Fifty Paise only"`

---

## 4. Seller Configuration Profile

The shop's identity and tax credentials are managed via [**`SellerConfigService`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/seller-config.service.ts).

### Model (`SellerConfig`)
```typescript
export interface SellerConfig {
  businessName: string;     // e.g., 'Shree Sales Agency'
  subtitle: string;         // e.g., 'School & Office Stationary Wholesaler'
  address: string;          // e.g., 'Old Rojgar Office Road, Becharpura, Palanpur'
  sellerGstin: string;      // e.g., '24AIVPR6534P1Z8'
  pan: string;              // e.g., 'AIVPR6534P'
  mobiles: string[];        // Array of contact strings
  sellerState: string;      // e.g., 'Gujarat'
  sellerStateCode: string;  // e.g., '24'
  bankName: string;         // e.g., 'IDBI Bank – Palanpur'
  bankAccountNo: string;    // e.g., '0323102000013767'
  ifsc: string;             // e.g., 'IBKL0000323'
}
```

### Storage Persistence
Unlike transient cached domain entities that are wiped on sign-out, `SellerConfig` is stored in **Capacitor Preferences** under key `'seller_config'`. It acts as an app-level device setting that persists across user sessions.

---

## 5. PDF Invoice Generation (`PdfService`)

[**`PdfService`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/src/app/core/services/pdf.service.ts) dynamically loads `pdfmake` and its virtual font file (`vfs_fonts`) via dynamic `import()` to minimize initial bundle size.

Depending on `bill.isGstInvoice`, it renders one of two distinct document definitions:

### A. Non-GST Cash Receipt (`buildDocDefinition`)
- Optimized for compact receipts or quick counter sharing.
- Content sections:
  1. Company header and GSTIN note.
  2. Bill number and timestamp.
  3. Customer name & phone.
  4. Status badge (`PAID` in green or `DUE: ₹X.XX` in red).
  5. Simple item table: Item, Qty, Price, Discount, Total.
  6. Totals summary: Total, Discount, Grand Total, Amount Paid, Amount Due.

### B. Bordered A4 Tax Invoice (`buildGstDocDefinition`)
A legally compliant, bordered A4 portrait layout matching Indian commercial trade standards:

1. **Header Block**:
   - Centered **TAX INVOICE** label.
   - Dual-column header: Shop Trade Name, address, GSTIN, State & Code, PAN, phone numbers.
2. **Invoice & Buyer Metadata Grid**:
   - Left Cell: Buyer Name, Address, Buyer GSTIN, State & State Code.
   - Right Cell: Invoice Number (server 8-digit sequence), Date (`DD/MM/YYYY`), Payment Terms / Method, Cheque Number (if applicable).
3. **Itemized HSN & Tax Table**:
   - Columns: `Sr.`, `Description of Goods`, `HSN/SAC`, `Qty`, `Unit`, `Rate`, `Disc`, `Taxable Value`, `SGST (Rate/Amt)`, `CGST (Rate/Amt)` (or `IGST` for inter-state), `Total`.
4. **Summary & Declarations Block**:
   - Grand Total in numeric format with signed round-off.
   - Amount in Words string.
   - Bank Details: Bank Name, Account Number, IFSC code.
   - Legal declaration disclaimer ("Goods once sold will not be taken back...").
   - Authorized Signatory stamp box.

### Platform Sharing Mechanism
- **Web Browser**: Triggers standard browser file download via `pdfMake.createPdf(doc).download(filename)`.
- **Android / Native**:
  1. Encodes PDF to Base64 in memory.
  2. Writes the file to app cache directory via `@capacitor/filesystem`:
     ```typescript
     await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
     ```
  3. Launches native Android share sheet via `@capacitor/share`:
     ```typescript
     await Share.share({ title: `Invoice ${bill.billNo}`, url: fileResult.uri });
     ```
  Allows staff to immediately send invoices to customers via WhatsApp, Email, or Bluetooth printer apps.
