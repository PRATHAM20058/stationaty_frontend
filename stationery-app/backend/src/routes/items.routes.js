'use strict';

const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { itemToJson } = require('../mappers');

const router = express.Router();

const UNITS = ['pcs', 'box', 'dozen', 'pack'];

// Pull the known item fields out of a request body (ignore unknown extras like `id`/`pendingSync`).
function readItemBody(body) {
  const b = body || {};
  return {
    name: b.name,
    categoryId: b.categoryId ?? null,
    category: b.category ?? null,
    purchasePrice: Number(b.purchasePrice) || 0,
    sellingPrice: Number(b.sellingPrice) || 0,
    stockQty: Number(b.stockQty) || 0,
    unit: b.unit || 'pcs',
    sku: b.sku ?? null,
    godownLocation: b.godownLocation ?? null,
  };
}

function validateItem(fields) {
  if (!fields.name || typeof fields.name !== 'string') return 'name is required';
  if (!UNITS.includes(fields.unit)) return `unit must be one of: ${UNITS.join(', ')}`;
  return null;
}

// Keep tenants isolated: only accept a categoryId that belongs to this user; otherwise drop the
// reference (the denormalised `category` name is still kept). Prevents linking an item to another
// user's category id.
async function ownedCategoryId(categoryId, userId) {
  if (!categoryId) return null;
  const rows = await query('SELECT id FROM categories WHERE id = ? AND user_id = ?', [categoryId, userId]);
  return rows.length > 0 ? categoryId : null;
}

// GET /items -> the caller's items only
router.get('/', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM items WHERE user_id = ? ORDER BY name', [req.user.id]);
    res.json(rows.map(itemToJson));
  } catch (err) {
    next(err);
  }
});

// POST /items (fields minus id) -> 201 full item
router.post('/', async (req, res, next) => {
  try {
    const fields = readItemBody(req.body);
    const error = validateItem(fields);
    if (error) return res.status(400).json({ message: error });

    const id = crypto.randomUUID();
    const categoryId = await ownedCategoryId(fields.categoryId, req.user.id);
    await query(
      `INSERT INTO items
         (id, name, category_id, category, purchase_price, selling_price, stock_qty, unit, sku, godown_location, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, fields.name, categoryId, fields.category, fields.purchasePrice,
       fields.sellingPrice, fields.stockQty, fields.unit, fields.sku, fields.godownLocation, req.user.id]
    );
    const rows = await query('SELECT * FROM items WHERE id = ?', [id]);
    res.status(201).json(itemToJson(rows[0]));
  } catch (err) {
    next(err);
  }
});

// PUT /items/:id -> 200 full replace, incl. absolute stockQty (client-authoritative stock).
// Only the caller's own item can be updated.
router.put('/:id', async (req, res, next) => {
  try {
    const fields = readItemBody(req.body);
    const error = validateItem(fields);
    if (error) return res.status(400).json({ message: error });

    const categoryId = await ownedCategoryId(fields.categoryId, req.user.id);
    const result = await query(
      `UPDATE items SET
         name = ?, category_id = ?, category = ?, purchase_price = ?, selling_price = ?,
         stock_qty = ?, unit = ?, sku = ?, godown_location = ?
       WHERE id = ? AND user_id = ?`,
      [fields.name, categoryId, fields.category, fields.purchasePrice, fields.sellingPrice,
       fields.stockQty, fields.unit, fields.sku, fields.godownLocation, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Item not found' });
    const rows = await query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    res.json(itemToJson(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /items/:id -> 204 (only the caller's own item)
router.delete('/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
