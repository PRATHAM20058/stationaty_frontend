'use strict';

const express = require('express');
const crypto = require('crypto');
const { pool, query } = require('../db');
const { billToJson, deletedBillToJson } = require('../mappers');

const router = express.Router();

const PAYMENT_STATUSES = ['paid', 'pending', 'partial'];
const PAYMENT_METHODS = ['cash', 'upi', 'cheque'];

// Every `bills` column except `id` (kept in this exact order for INSERT ... SELECT between the
// live `bills` table and the `deleted_bills` archive, so DECIMALs copy byte-for-byte in-DB).
const BILL_COLS_NO_ID =
  'user_id, bill_no, customer_name, customer_phone, date, discount, total, grand_total, ' +
  'payment_status, amount_paid, amount_due, payment_method, cheque_no, is_gst_invoice, gst_type, ' +
  'seller_gstin, seller_state_code, buyer_gstin, buyer_state, buyer_state_code, taxable_amount, ' +
  'sgst_total, cgst_total, igst_total, round_off, amount_in_words';
// Every `bill_items` column except the auto `id` and the bill foreign key.
const BILL_ITEM_COLS =
  'item_id, item_name, qty, price, subtotal, discount, hsn_code, gst_percent, taxable_value, sgst, cgst, igst';

// Convert the client's ISO-8601 instant to a MySQL DATETIME string (UTC).
function toMysqlDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return valid.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate the next invoice number for this user: a plain, zero-padded 8-digit sequence
// (00000001, 00000002, ...). Numbering is per-user, so each shop's bills start at 1.
// Robust to legacy "BILL-00000x" rows: we take the largest numeric suffix across whatever
// formats exist so the sequence keeps incrementing across the format change.
async function nextBillNo(conn, userId) {
  const [rows] = await conn.query('SELECT bill_no FROM bills WHERE user_id = ?', [userId]);
  let max = 0;
  for (const r of rows) {
    const digits = String(r.bill_no || '').replace(/\D/g, '');
    if (!digits) continue;
    const n = parseInt(digits, 10);
    // Guard against a stray oversized value (e.g. an old timestamp-based temp number).
    if (Number.isFinite(n) && n < 100000000 && n > max) max = n;
  }
  return String(max + 1).padStart(8, '0');
}

// Load a full bill (row + nested items) as client JSON for this user, or null if missing/not theirs.
async function loadBill(id, userId) {
  const bills = await query('SELECT * FROM bills WHERE id = ? AND user_id = ?', [id, userId]);
  if (bills.length === 0) return null;
  const items = await query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', [id]);
  return billToJson(bills[0], items);
}

// Insert the line items for a bill (used by create and by full-bill edits).
async function insertBillItems(conn, billId, items) {
  for (const line of items || []) {
    await conn.query(
      `INSERT INTO bill_items (bill_id, item_id, item_name, qty, price, subtotal, discount, hsn_code, gst_percent, taxable_value, sgst, cgst, igst)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billId,
        line.itemId ?? null,
        line.itemName ?? '',
        Number(line.qty) || 0,
        Number(line.price) || 0,
        Number(line.subtotal) || 0,
        Number(line.discount) || 0,
        line.hsnCode ?? null,
        Number(line.gstPercent) || 0,
        line.taxableValue === null || line.taxableValue === undefined ? null : Number(line.taxableValue),
        Number(line.sgst) || 0,
        Number(line.cgst) || 0,
        Number(line.igst) || 0,
      ]
    );
  }
}

// GET /bills -> the caller's bills with nested items
router.get('/', async (req, res, next) => {
  try {
    const bills = await query('SELECT * FROM bills WHERE user_id = ? ORDER BY date DESC', [req.user.id]);
    const allItems = await query(
      `SELECT bi.* FROM bill_items bi JOIN bills b ON bi.bill_id = b.id WHERE b.user_id = ? ORDER BY bi.id`,
      [req.user.id]
    );
    const byBill = new Map();
    for (const it of allItems) {
      if (!byBill.has(it.bill_id)) byBill.set(it.bill_id, []);
      byBill.get(it.bill_id).push(it);
    }
    res.json(bills.map((b) => billToJson(b, byBill.get(b.id) || [])));
  } catch (err) {
    next(err);
  }
});

// --- Deleted-bill archive --------------------------------------------------------------------
// These `/deleted...` routes are declared BEFORE the `/:id` routes below so `deleted` is never
// captured as an `:id`. All are user-scoped (a user never sees another user's archived bills).

// GET /bills/deleted -> the caller's archived bills (newest first), with nested items.
// Optional `from`/`to` filter by deletion time; `limit` (default 100, max 500) / `offset`.
router.get('/deleted', async (req, res, next) => {
  try {
    const clauses = ['user_id = ?'];
    const vals = [req.user.id];
    if (req.query.from) {
      clauses.push('deleted_at >= ?');
      vals.push(toMysqlDate(req.query.from));
    }
    if (req.query.to) {
      clauses.push('deleted_at <= ?');
      vals.push(toMysqlDate(req.query.to));
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const bills = await query(
      `SELECT * FROM deleted_bills WHERE ${clauses.join(' AND ')} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );
    if (bills.length === 0) return res.json([]);

    const ids = bills.map((b) => b.original_bill_id);
    const placeholders = ids.map(() => '?').join(',');
    const items = await query(
      `SELECT * FROM deleted_bill_items WHERE deleted_bill_id IN (${placeholders}) ORDER BY id`,
      ids
    );
    const byBill = new Map();
    for (const it of items) {
      if (!byBill.has(it.deleted_bill_id)) byBill.set(it.deleted_bill_id, []);
      byBill.get(it.deleted_bill_id).push(it);
    }
    res.json(bills.map((b) => deletedBillToJson(b, byBill.get(b.original_bill_id) || [])));
  } catch (err) {
    next(err);
  }
});

// GET /bills/deleted/:id -> one archived bill (this user's), or 404.
router.get('/deleted/:id', async (req, res, next) => {
  try {
    const bills = await query('SELECT * FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (bills.length === 0) return res.status(404).json({ message: 'Deleted bill not found' });
    const items = await query('SELECT * FROM deleted_bill_items WHERE deleted_bill_id = ? ORDER BY id', [req.params.id]);
    res.json(deletedBillToJson(bills[0], items));
  } catch (err) {
    next(err);
  }
});

// POST /bills/deleted/:id/restore -> move the archived record back into bills/bill_items and
// remove it from the archive. 404 if not this user's; 409 if a live bill with that id or bill_no
// already exists. Does NOT touch stock (stock is client-authoritative). Returns the restored bill.
router.post('/deleted/:id/restore', async (req, res, next) => {
  const id = req.params.id;
  const userId = req.user.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [arch] = await conn.query('SELECT bill_no FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?', [
      id,
      userId,
    ]);
    if (arch.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Deleted bill not found' });
    }

    const [conflict] = await conn.query('SELECT id FROM bills WHERE (id = ? OR bill_no = ?) AND user_id = ?', [
      id,
      arch[0].bill_no,
      userId,
    ]);
    if (conflict.length > 0) {
      await conn.rollback();
      return res.status(409).json({ message: 'A live bill with this id or bill number already exists' });
    }

    await conn.query(
      `INSERT INTO bills (id, ${BILL_COLS_NO_ID})
       SELECT original_bill_id, ${BILL_COLS_NO_ID} FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?`,
      [id, userId]
    );
    await conn.query(
      `INSERT INTO bill_items (bill_id, ${BILL_ITEM_COLS})
       SELECT deleted_bill_id, ${BILL_ITEM_COLS} FROM deleted_bill_items WHERE deleted_bill_id = ?`,
      [id]
    );
    await conn.query('DELETE FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?', [id, userId]);

    await conn.commit();
    const restored = await loadBill(id, userId);
    res.json(restored);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /bills/deleted/:id -> hard purge from the archive (this user's). 204, idempotent.
router.delete('/deleted/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /bills -> 201 full stored bill. Ignore incoming id/billNo; assign our own.
// Stock is client-authoritative: do NOT touch items.stock_qty here.
router.post('/', async (req, res, next) => {
  const body = req.body || {};

  if (body.paymentStatus && !PAYMENT_STATUSES.includes(body.paymentStatus)) {
    return res.status(400).json({ message: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}` });
  }
  if (body.paymentMethod != null && !PAYMENT_METHODS.includes(body.paymentMethod)) {
    return res.status(400).json({ message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }
  if (!body.customerName || typeof body.customerName !== 'string') {
    return res.status(400).json({ message: 'customerName is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const id = crypto.randomUUID();
    const billNo = await nextBillNo(conn, req.user.id);

    await conn.query(
      `INSERT INTO bills
         (id, bill_no, customer_name, customer_phone, date, discount, total, grand_total,
          payment_status, amount_paid, amount_due, payment_method, cheque_no,
          is_gst_invoice, gst_type, seller_gstin, seller_state_code, buyer_gstin, buyer_state, buyer_state_code,
          taxable_amount, sgst_total, cgst_total, igst_total, round_off, amount_in_words, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        billNo,
        body.customerName,
        body.customerPhone ?? null,
        toMysqlDate(body.date),
        Number(body.discount) || 0,
        Number(body.total) || 0,
        Number(body.grandTotal) || 0,
        body.paymentStatus || 'paid',
        Number(body.amountPaid) || 0,
        Number(body.amountDue) || 0,
        body.paymentMethod ?? null,
        body.chequeNo ?? null,
        body.isGstInvoice ? 1 : 0,
        body.gstType || 'none',
        body.sellerGstin ?? null,
        body.sellerStateCode ?? null,
        body.buyerGstin ?? null,
        body.buyerState ?? null,
        body.buyerStateCode ?? null,
        Number(body.taxableAmount) || 0,
        Number(body.sgstTotal) || 0,
        Number(body.cgstTotal) || 0,
        Number(body.igstTotal) || 0,
        Number(body.roundOff) || 0,
        body.amountInWords ?? null,
        req.user.id,
      ]
    );
    await insertBillItems(conn, id, body.items);

    await conn.commit();
    const stored = await loadBill(id, req.user.id);
    res.status(201).json(stored);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// PUT /bills/:id/payment -> 200. Idempotent upsert: apply whatever fields are present.
// Dual-purpose: small payment patch OR a full recomputed bill (with items[]).
router.put('/:id/payment', async (req, res, next) => {
  const body = req.body || {};
  const id = req.params.id;

  if (body.paymentStatus && !PAYMENT_STATUSES.includes(body.paymentStatus)) {
    return res.status(400).json({ message: `paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}` });
  }
  if (body.paymentMethod != null && !PAYMENT_METHODS.includes(body.paymentMethod)) {
    return res.status(400).json({ message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query('SELECT id FROM bills WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (existing.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Bill not found' });
    }

    // Map camelCase body fields to columns; only update ones actually present.
    const colMap = {
      customerName: 'customer_name',
      customerPhone: 'customer_phone',
      discount: 'discount',
      total: 'total',
      grandTotal: 'grand_total',
      paymentStatus: 'payment_status',
      amountPaid: 'amount_paid',
      amountDue: 'amount_due',
      paymentMethod: 'payment_method',
      chequeNo: 'cheque_no',
      isGstInvoice: 'is_gst_invoice',
      gstType: 'gst_type',
      sellerGstin: 'seller_gstin',
      sellerStateCode: 'seller_state_code',
      buyerGstin: 'buyer_gstin',
      buyerState: 'buyer_state',
      buyerStateCode: 'buyer_state_code',
      taxableAmount: 'taxable_amount',
      sgstTotal: 'sgst_total',
      cgstTotal: 'cgst_total',
      igstTotal: 'igst_total',
      roundOff: 'round_off',
      amountInWords: 'amount_in_words',
    };
    const numeric = new Set([
      'discount', 'total', 'grandTotal', 'amountPaid', 'amountDue',
      'taxableAmount', 'sgstTotal', 'cgstTotal', 'igstTotal', 'roundOff',
    ]);
    const boolean = new Set(['isGstInvoice']);

    const sets = [];
    const vals = [];
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        sets.push(`${col} = ?`);
        let value;
        if (numeric.has(key)) value = Number(body[key]) || 0;
        else if (boolean.has(key)) value = body[key] ? 1 : 0;
        else value = body[key] ?? null;
        vals.push(value);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'date')) {
      sets.push('date = ?');
      vals.push(toMysqlDate(body.date));
    }
    if (sets.length > 0) {
      vals.push(id, req.user.id);
      await conn.query(`UPDATE bills SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, vals);
    }

    // Full-bill edit: replace line items when an items array is present.
    if (Array.isArray(body.items)) {
      await conn.query('DELETE FROM bill_items WHERE bill_id = ?', [id]);
      await insertBillItems(conn, id, body.items);
    }

    await conn.commit();
    const stored = await loadBill(id, req.user.id);
    res.json(stored);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /bills/:id -> 204 (only the caller's own bill). Instead of destroying the record, move
// the full bill + items into the deleted_bills/deleted_bill_items archive, transactionally.
// Accepts an optional { reason } in the body. Idempotent: replays (the sync queue can send the
// same delete more than once) short-circuit to 204 without creating a duplicate archive row.
// Do NOT touch stock -- it's client-authoritative.
router.delete('/:id', async (req, res, next) => {
  const id = req.params.id;
  const userId = req.user.id;
  const rawReason = req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const reason = rawReason ? rawReason.slice(0, 255) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [live] = await conn.query('SELECT id FROM bills WHERE id = ? AND user_id = ?', [id, userId]);
    if (live.length === 0) {
      // Nothing live to delete: either it never existed, or this is a replay of an already-
      // archived delete. Preserve today's missing-bill behavior and stay idempotent.
      await conn.commit();
      return res.status(204).end();
    }

    // Defensive: clear any stale archive row for this id so the archive insert can't duplicate.
    await conn.query('DELETE FROM deleted_bills WHERE original_bill_id = ? AND user_id = ?', [id, userId]);

    await conn.query(
      `INSERT INTO deleted_bills (original_bill_id, ${BILL_COLS_NO_ID}, deleted_at, deleted_by, delete_reason)
       SELECT id, ${BILL_COLS_NO_ID}, ?, ?, ? FROM bills WHERE id = ? AND user_id = ?`,
      [toMysqlDate(), userId, reason, id, userId]
    );
    await conn.query(
      `INSERT INTO deleted_bill_items (deleted_bill_id, ${BILL_ITEM_COLS})
       SELECT bill_id, ${BILL_ITEM_COLS} FROM bill_items WHERE bill_id = ?`,
      [id]
    );

    await conn.query('DELETE FROM bills WHERE id = ? AND user_id = ?', [id, userId]); // FK cascade removes bill_items

    await conn.commit();
    res.status(204).end();
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
