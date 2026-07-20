'use strict';

const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { categoryToJson } = require('../mappers');

const router = express.Router();

// GET /categories -> the caller's categories only
router.get('/', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM categories WHERE user_id = ? ORDER BY name', [req.user.id]);
    res.json(rows.map(categoryToJson));
  } catch (err) {
    next(err);
  }
});

// POST /categories { name } -> 201 { id, name }
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body || {}).name;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'name is required' });
    }
    const id = crypto.randomUUID();
    await query('INSERT INTO categories (id, name, user_id) VALUES (?, ?, ?)', [id, name, req.user.id]);
    res.status(201).json({ id, name });
  } catch (err) {
    next(err);
  }
});

// PUT /categories/:id { name } -> 200 { id, name } (only the caller's own row)
router.put('/:id', async (req, res, next) => {
  try {
    const name = (req.body || {}).name;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'name is required' });
    }
    const result = await query('UPDATE categories SET name = ? WHERE id = ? AND user_id = ?', [
      name,
      req.params.id,
      req.user.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Category not found' });
    res.json({ id: req.params.id, name });
  } catch (err) {
    next(err);
  }
});

// DELETE /categories/:id -> 204 (only the caller's own row)
router.delete('/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
