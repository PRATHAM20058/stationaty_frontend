'use strict';

require('dotenv').config();
const app = require('./app');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;

async function boot() {
  // Ensure schema + admin exist before we start accepting requests.
  await seed();
  app.listen(PORT, () => {
    console.log(`Stationery backend listening on http://localhost:${PORT}/api`);
  });
}

boot().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
