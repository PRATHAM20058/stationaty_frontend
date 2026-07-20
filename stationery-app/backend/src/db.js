'use strict';

const mysql = require('mysql2/promise');

// A single shared connection pool for the whole app.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Keep DATETIME as raw strings; we store/return ISO instants ourselves.
  dateStrings: true,
});

// Small helper so routes can `const rows = await query(sql, params)`.
async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };
