import { GstType } from '../models/bill.model';

/** Rounds to 2 decimals (paise) via integer-paise math to avoid binary float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Per-line inputs calcGstBill needs (a structural subset of BillItem). */
export interface GstLineInput {
  subtotal: number;
  discount: number;
  gstPercent?: number | null;
}

/** Bill-level inputs calcGstBill needs (a structural subset of Bill). */
export interface GstBillInput {
  isGstInvoice?: boolean;
  buyerStateCode?: string | null;
  items: GstLineInput[];
}

/** Seller-side inputs (a structural subset of SellerConfig). */
export interface GstSellerInput {
  sellerStateCode: string;
}

export interface GstLineResult {
  gstPercent: number;
  taxableValue: number;
  sgst: number;
  cgst: number;
  igst: number;
}

export interface GstBillResult {
  gstType: GstType;
  /** Aligned by index with the input items. */
  lines: GstLineResult[];
  taxableAmount: number;
  sgstTotal: number;
  cgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
}

/**
 * Pure GST computation. Works on the discount-net value of each line and never mutates the
 * subtotal/discount fields. For a non-GST bill (isGstInvoice false) every tax and the round-off
 * are 0 and grandTotal === total - discount, so legacy bills are unaffected.
 */
export function calcGstBill(bill: GstBillInput, seller: GstSellerInput): GstBillResult {
  const gstType: GstType = !bill.isGstInvoice
    ? 'none'
    : (bill.buyerStateCode ?? '') === seller.sellerStateCode
      ? 'intra'
      : 'inter';

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

  const taxableAmount = round2(lines.reduce((s, l) => s + l.taxableValue, 0));
  const sgstTotal = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const cgstTotal = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const igstTotal = round2(lines.reduce((s, l) => s + l.igst, 0));

  const raw = taxableAmount + sgstTotal + cgstTotal + igstTotal;
  // Only GST invoices round to a whole rupee; a non-GST bill keeps exact paise so grandTotal
  // stays identical to the legacy total - discount.
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

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Words for 0..99 with each word capitalized, e.g. 70 -> "Seventy", 21 -> "Twenty One". */
function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t} ${ONES[o]}` : t;
}

/**
 * Indian-numbering words (lakh / crore) for a rupee amount. Digit words are capitalized while
 * scale words (crore/lakh/thousand/hundred) are lowercase, matching the invoice convention,
 * e.g. numberToWordsIndian(3870) === "Three thousand Eight hundred Seventy Rs only".
 * Paise (if any) are appended before "only".
 */
export function numberToWordsIndian(amount: number): string {
  const rounded = round2(amount);
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  const rupeeWords = rupees === 0 ? 'Zero' : integerToWords(rupees);
  const paiseSuffix = paise > 0 ? ` and ${twoDigitWords(paise)} Paise` : '';
  return `${rupeeWords} Rs${paiseSuffix} only`;
}

function integerToWords(n: number): string {
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  const parts: string[] = [];
  if (crore) parts.push(`${twoDigitWords(crore)} crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} thousand`);
  if (hundred) parts.push(`${ONES[hundred]} hundred`);
  if (rest) parts.push(twoDigitWords(rest));
  return parts.join(' ');
}
