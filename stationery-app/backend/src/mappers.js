'use strict';

// mysql2 returns DECIMAL columns as strings; the client wants plain JSON numbers.
function num(v) {
  return v === null || v === undefined ? v : Number(v);
}

// DATETIME comes back (with dateStrings) as "YYYY-MM-DD HH:MM:SS" in UTC. Re-emit it as a
// proper ISO-8601 instant so the client parses the correct moment, not a local-time shift.
function toIso(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v).replace(' ', 'T') + 'Z').toISOString();
}

// --- Categories -----------------------------------------------------------
function categoryToJson(row) {
  return { id: row.id, name: row.name };
}

// --- Items ----------------------------------------------------------------
function itemToJson(row) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    category: row.category,
    purchasePrice: num(row.purchase_price),
    sellingPrice: num(row.selling_price),
    stockQty: num(row.stock_qty),
    unit: row.unit,
    sku: row.sku,
    godownLocation: row.godown_location,
    hsnCode: row.hsn_code ?? null,
    gstPercent: row.gst_percent === null || row.gst_percent === undefined ? null : num(row.gst_percent),
  };
}

// --- Bills ----------------------------------------------------------------
function billItemToJson(row) {
  return {
    itemId: row.item_id,
    itemName: row.item_name,
    qty: num(row.qty),
    price: num(row.price),
    subtotal: num(row.subtotal),
    discount: num(row.discount),
    hsnCode: row.hsn_code ?? null,
    gstPercent: num(row.gst_percent),
    taxableValue: row.taxable_value === null || row.taxable_value === undefined ? undefined : num(row.taxable_value),
    sgst: num(row.sgst),
    cgst: num(row.cgst),
    igst: num(row.igst),
  };
}

// `billRow` is the bills row; `itemRows` are its bill_items rows (already filtered).
function billToJson(billRow, itemRows) {
  return {
    id: billRow.id,
    billNo: billRow.bill_no,
    customerName: billRow.customer_name,
    customerPhone: billRow.customer_phone,
    date: toIso(billRow.date),
    items: (itemRows || []).map(billItemToJson),
    discount: num(billRow.discount),
    total: num(billRow.total),
    grandTotal: num(billRow.grand_total),
    paymentStatus: billRow.payment_status,
    amountPaid: num(billRow.amount_paid),
    amountDue: num(billRow.amount_due),
    paymentMethod: billRow.payment_method,
    chequeNo: billRow.cheque_no === null ? undefined : billRow.cheque_no,
    isGstInvoice: !!billRow.is_gst_invoice,
    gstType: billRow.gst_type ?? 'none',
    sellerGstin: billRow.seller_gstin ?? undefined,
    sellerStateCode: billRow.seller_state_code ?? undefined,
    buyerGstin: billRow.buyer_gstin ?? null,
    buyerState: billRow.buyer_state ?? null,
    buyerStateCode: billRow.buyer_state_code ?? null,
    taxableAmount: num(billRow.taxable_amount),
    sgstTotal: num(billRow.sgst_total),
    cgstTotal: num(billRow.cgst_total),
    igstTotal: num(billRow.igst_total),
    roundOff: num(billRow.round_off),
    amountInWords: billRow.amount_in_words ?? undefined,
  };
}

// `row` is a deleted_bills row; `itemRows` are its deleted_bill_items rows (already filtered).
// Same shape as a live bill (its columns mirror `bills`) but keyed by the original bill id and
// carrying the deletion metadata.
function deletedBillToJson(row, itemRows) {
  return {
    ...billToJson(row, itemRows),
    id: row.original_bill_id,
    deletedAt: toIso(row.deleted_at),
    deletedBy: row.deleted_by ?? null,
    deleteReason: row.delete_reason ?? null,
  };
}

module.exports = { categoryToJson, itemToJson, billItemToJson, billToJson, deletedBillToJson, num };
