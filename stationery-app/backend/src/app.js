'use strict';

const express = require('express');
const cors = require('cors');

const requireAuth = require('./auth/jwt.middleware');
const authRoutes = require('./auth/auth.routes');
const categoriesRoutes = require('./routes/categories.routes');
const itemsRoutes = require('./routes/items.routes');
const billsRoutes = require('./routes/bills.routes');

const app = express();

// CORS: allow the Ionic dev server + Capacitor webview origins from env.
const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      // Allow non-browser tools (curl/Postman: no Origin) and any allow-listed origin.
      if (!origin || origins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);

app.use(express.json());

// Lightweight request log (helps confirm the app/emulator is actually reaching the backend).
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} origin=${req.headers.origin || '-'}`);
  next();
});

// Open reachability probe (no auth) so the client can tell "up" from "unreachable".
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Open auth route.
app.use('/api/auth', authRoutes);

// Everything else requires a valid JWT.
app.use('/api/categories', requireAuth, categoriesRoutes);
app.use('/api/items', requireAuth, itemsRoutes);
app.use('/api/bills', requireAuth, billsRoutes);

// JSON 404.
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Centralised error handler -> JSON body (so the client treats it as "reachable but rejected").
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
