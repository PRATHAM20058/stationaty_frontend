export type PaymentStatus = 'paid' | 'pending' | 'partial';
export type PaymentMethod = 'cash' | 'upi' | 'cheque' | null;
/** none = non-GST bill; intra = same-state (SGST+CGST); inter = other-state (IGST). */
export type GstType = 'intra' | 'inter' | 'none';

export interface BillItem {
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
  /** Gross line amount (qty x price), before this line's discount. */
  subtotal: number;
  /** Monetary discount applied to this line only -- bills are discounted per item, not as a whole. */
  discount: number;
  // --- GST fields (all optional; 0/null so a non-GST line is identical to before) ---
  /** HSN/SAC code, defaulted from the item, editable per line. */
  hsnCode?: string | null;
  /** GST rate for this line, defaulted from the item, editable. 0 on a non-GST bill. */
  gstPercent?: number;
  /** Discount-net value the tax is computed on: subtotal - discount. */
  taxableValue?: number;
  /** Half-rate SGST amount (intra-state only). */
  sgst?: number;
  /** Half-rate CGST amount (intra-state only). */
  cgst?: number;
  /** Full-rate IGST amount (inter-state only). */
  igst?: number;
}

export interface Bill {
  id: string;
  billNo: string;
  customerName: string;
  customerPhone?: string;
  date: string;
  items: BillItem[];
  discount: number;
  total: number;
  /** = taxableAmount + sgstTotal + cgstTotal + igstTotal + roundOff. For a non-GST bill this
      still equals total - discount (all taxes and roundOff are 0). */
  grandTotal: number;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  amountDue: number;
  paymentMethod?: PaymentMethod;
  /** Only meaningful when paymentMethod is 'cheque'. May be added after the bill is created. */
  chequeNo?: string;
  // --- GST fields (all optional; default so a legacy bill computes & renders as today) ---
  /** When true, this bill is a GST tax invoice (taxes computed, GST print layout used). */
  isGstInvoice?: boolean;
  gstType?: GstType;
  sellerGstin?: string;
  sellerStateCode?: string;
  buyerGstin?: string | null;
  buyerState?: string | null;
  buyerStateCode?: string | null;
  /** = total - discount (== legacy grandTotal). Sum of per-line taxableValue. */
  taxableAmount?: number;
  sgstTotal?: number;
  cgstTotal?: number;
  igstTotal?: number;
  /** Signed rounding adjustment to reach a whole-rupee grand total, e.g. +0.01 / -0.03. */
  roundOff?: number;
  /** Indian-numbering words for grandTotal, e.g. "Three thousand Eight hundred Seventy Rs only". */
  amountInWords?: string;
  /** Present only while a local create/update/delete hasn't reached the server yet. */
  pendingSync?: boolean;
}
