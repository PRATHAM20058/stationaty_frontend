'use strict';

const express = require('express');
const crypto = require('crypto');
const { pool, query } = require('../db');
const { billToJson } = require('../mappers');

const router = express.Router();

const PAYMENT_STATUSES = ['paid', 'pending', 'partial'];
const PAYMENT_METHODS = ['cash', 'upi', 'cheque'];

// Convert the client's ISO-8601 instant to a MySQL DATETIME string (UTC).
function toMysqlDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return valid.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate the next human-friendly bill number for this user: BILL-000001, BILL-000002, ...
// Numbering is per-user, so each shop's bills start at 1.
async function nextBillNo(conn, userId) {
  const [rows] = await conn.query(
    "SELECT bill_no FROM bills WHERE user_id = ? AND bill_no REGEXP '^BILL-[0-9]+$' ORDER BY CAST(SUBSTRING(bill_no, 6) AS UNSIGNED) DESC LIMIT 1",
    [userId]
  );
  let next = 1;
  if (rows.length > 0) {
    next = parseInt(rows[0].bill_no.slice(5), 10) + 1;
  }
  return 'BILL-' + String(next).padStart(6, '0');
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
      `INSERT INTO bill_items (bill_id, item_id, item_name, qty, price, subtotal, discount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        billId,
        line.itemId ?? null,
        line.itemName ?? '',
        Number(line.qty) || 0,
        Number(line.price) || 0,
        Number(line.subtotal) || 0,
        Number(line.discount) || 0,
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
          payment_status, amount_paid, amount_due, payment_method, cheque_no, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    };
    const numeric = new Set(['discount', 'total', 'grandTotal', 'amountPaid', 'amountDue']);

    const sets = [];
    const vals = [];
    for (const [key, col] of Object.entries(colMap)) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        sets.push(`${col} = ?`);
        vals.push(numeric.has(key) ? (Number(body[key]) || 0) : (body[key] ?? null));
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

// DELETE /bills/:id -> 204 (only the caller's own bill). FK cascade removes bill_items. Do NOT restore stock.
router.delete('/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM bills WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
