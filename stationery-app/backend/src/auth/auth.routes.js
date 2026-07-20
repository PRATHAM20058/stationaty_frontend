'use strict';

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../db');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

// POST /auth/signup  { name, username, password } -> { token, user }
router.post('/signup', async (req, res, next) => {
  try {
    const { name, username, password } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ message: 'name, username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'password must be at least 6 characters' });
    }

    const existing = await query('SELECT id FROM auth_users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(String(password), 10);
    // Self-service signups are shop owners of their own (initially empty) store.
    await query(
      'INSERT INTO auth_users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [id, name, username, hash, 'owner']
    );

    return res.status(201).json({
      token: signToken(id),
      user: { id, name, role: 'owner' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login  { username, password } -> { token, user }
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'username and password are required' });
    }

    const rows = await query('SELECT * FROM auth_users WHERE username = ?', [username]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Never leak the hash.
    return res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
