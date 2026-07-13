#!/usr/bin/env bash
# Create the stationery database + a dedicated app user.
# Uses `root` (no password by default on a fresh Homebrew MySQL). Pass the password with -p if you set one.
set -euo pipefail

DB_NAME="${DB_NAME:-stationery}"
DB_USER="${DB_USER:-stationery}"
DB_PASSWORD="${DB_PASSWORD:-stationery123}"

mysql -u root "$@" <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "Database '${DB_NAME}' and user '${DB_USER}' are ready."
