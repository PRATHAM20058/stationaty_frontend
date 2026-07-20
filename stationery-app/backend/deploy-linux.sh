#!/usr/bin/env bash
#
# deploy-linux.sh — one-shot deployer for the Stationery backend on a Linux Lite / Ubuntu
# 24x7 home server. Covers BOTH options from DEPLOY_LINUX.md:
#
#   --mode lan     Option A: LAN-only over HTTP (app -> http://<server-ip>:3000)
#   --mode https   Option B: Internet + HTTPS via a Caddy reverse proxy (+ optional DuckDNS)
#                  (app -> https://<domain>/api)
#
# It installs Node.js + MySQL, creates the DB/user, writes .env, installs deps, seeds the
# schema/admin, and runs the API 24x7 as a systemd service. For --mode https it also installs
# Caddy (automatic Let's Encrypt HTTPS) and, if a DuckDNS token is given, a DuckDNS updater.
#
# The script is idempotent — safe to re-run. Run it from the backend/ folder with sudo:
#
#   sudo ./deploy-linux.sh --mode lan
#   sudo ./deploy-linux.sh --mode https --domain you.duckdns.org --duckdns-token <TOKEN>
#
# Options:
#   --mode lan|https        (required) deployment style
#   --domain <fqdn>         (https) the public domain, e.g. you.duckdns.org
#   --duckdns-token <tok>   (https, optional) enables a DuckDNS auto-updater for the subdomain
#   --db-pass <pass>        DB password for the 'stationery' user (default: reuse .env or random)
#   --port <n>              API port (default: 3000)
#   --node-major <n>        Node major to install if missing (default: 20)
#
set -euo pipefail

# ---- defaults ---------------------------------------------------------------
MODE=""
DOMAIN=""
DUCKDNS_TOKEN=""
DB_PASS=""
PORT="3000"
NODE_MAJOR="20"
DB_NAME="stationery"
DB_USER="stationery"
SERVICE_NAME="stationery-backend"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- parse args -------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)          MODE="${2:-}"; shift 2 ;;
    --domain)        DOMAIN="${2:-}"; shift 2 ;;
    --duckdns-token) DUCKDNS_TOKEN="${2:-}"; shift 2 ;;
    --db-pass)       DB_PASS="${2:-}"; shift 2 ;;
    --port)          PORT="${2:-}"; shift 2 ;;
    --node-major)    NODE_MAJOR="${2:-}"; shift 2 ;;
    -h|--help)       grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "unknown option: $1 (try --help)" ;;
  esac
done

[[ "$MODE" == "lan" || "$MODE" == "https" ]] || die "must pass --mode lan|https"
[[ $EUID -eq 0 ]] || die "run me with sudo (needs apt/systemd): sudo $0 --mode $MODE ..."
if [[ "$MODE" == "https" ]]; then
  [[ -n "$DOMAIN" ]] || die "--mode https requires --domain <fqdn> (e.g. you.duckdns.org)"
fi

# The unprivileged user + folder the service will run as / from.
RUN_USER="${SUDO_USER:-root}"
[[ "$RUN_USER" != "root" ]] || warn "no SUDO_USER detected; the service will run as root."
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
[[ -f "$APP_DIR/package.json" ]] || die "run this script from the backend/ folder (no package.json in $APP_DIR)"

log "Deploying '$SERVICE_NAME' from $APP_DIR as user '$RUN_USER' (mode=$MODE, port=$PORT)"

# ---- 1. base packages -------------------------------------------------------
log "Installing base packages (curl, git, ca-certificates)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git

# ---- 2. Node.js -------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  [[ "$cur_major" -ge "$NODE_MAJOR" ]] && need_node=0
fi
if [[ "$need_node" -eq 1 ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node $(node -v) already present — skipping."
fi
NODE_BIN="$(command -v node)"

# ---- 3. MySQL ---------------------------------------------------------------
log "Installing/starting MySQL…"
apt-get install -y mysql-server
systemctl enable --now mysql

# Decide the DB password: explicit arg > existing .env > generated.
if [[ -z "$DB_PASS" && -f "$APP_DIR/.env" ]]; then
  DB_PASS="$(grep -E '^DB_PASSWORD=' "$APP_DIR/.env" | head -1 | cut -d= -f2- || true)"
fi
[[ -n "$DB_PASS" ]] || DB_PASS="$(openssl rand -hex 16 2>/dev/null || node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"

log "Ensuring database '$DB_NAME' and user '$DB_USER'…"
# `mysql` as root works via unix_socket auth when run as root (Ubuntu default).
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

# ---- 4. .env ----------------------------------------------------------------
# CORS: the Capacitor webview origin is always localhost (not the server IP/domain), so this
# list is the same for both modes.
CORS="http://localhost:8100,capacitor://localhost,http://localhost,https://localhost"
if [[ ! -f "$APP_DIR/.env" ]]; then
  log "Writing .env…"
  JWT_SECRET="$($NODE_BIN -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > "$APP_DIR/.env" <<ENV
PORT=$PORT
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_NAME=$DB_NAME
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=30d
CORS_ORIGINS=$CORS
ENV
  chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  log ".env already exists — keeping it (only syncing DB password)."
  # Keep the stored password in sync with the DB user we just (re)set.
  if grep -qE '^DB_PASSWORD=' "$APP_DIR/.env"; then
    sed -i -E "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASS|" "$APP_DIR/.env"
  fi
fi

# ---- 5. deps + seed (as the run user) --------------------------------------
log "Installing npm dependencies…"
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm ci"
else
  sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install"
fi
log "Seeding schema + admin (idempotent)…"
sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm run seed"

# ---- 6. systemd service -----------------------------------------------------
log "Installing systemd service '$SERVICE_NAME'…"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Stationery Shop Backend (Node/Express)
After=network-online.target mysql.service
Wants=network-online.target
Requires=mysql.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
sleep 2
systemctl is-active --quiet "$SERVICE_NAME" || { journalctl -u "$SERVICE_NAME" -n 30 --no-pager; die "service failed to start (logs above)"; }
log "Service is running."

# ---- 7. firewall ------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 || apt-get install -y ufw; then
  if [[ "$MODE" == "lan" ]]; then
    log "Opening firewall port $PORT/tcp (LAN)…"
    ufw allow "${PORT}/tcp" || true
  else
    log "Opening firewall ports 80,443/tcp (HTTPS) and $PORT/tcp (LAN)…"
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    ufw allow "${PORT}/tcp" || true
  fi
  ufw --force enable || true
fi

# ---- 8. HTTPS extras (Caddy + optional DuckDNS) ----------------------------
if [[ "$MODE" == "https" ]]; then
  log "Installing Caddy (automatic HTTPS reverse proxy)…"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi

  log "Writing Caddyfile for $DOMAIN -> 127.0.0.1:$PORT…"
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
  systemctl restart caddy
  systemctl enable caddy

  # Optional DuckDNS auto-updater (keeps the DNS record pointed at your changing home IP).
  if [[ -n "$DUCKDNS_TOKEN" ]]; then
    SUBDOMAIN="${DOMAIN%%.*}"
    log "Setting up DuckDNS updater for subdomain '$SUBDOMAIN'…"
    cat > /usr/local/bin/duckdns-update.sh <<DUCK
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=$SUBDOMAIN&token=$DUCKDNS_TOKEN&ip=" -o /dev/null
DUCK
    chmod 700 /usr/local/bin/duckdns-update.sh
    cat > /etc/systemd/system/duckdns.service <<'SVC'
[Unit]
Description=DuckDNS IP updater
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/duckdns-update.sh
SVC
    cat > /etc/systemd/system/duckdns.timer <<'TMR'
[Unit]
Description=Run DuckDNS updater every 5 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
TMR
    systemctl daemon-reload
    systemctl enable --now duckdns.timer
    /usr/local/bin/duckdns-update.sh || warn "initial DuckDNS update failed — check the token."
  fi
fi

# ---- 9. summary -------------------------------------------------------------
SERVER_IP="$(hostname -I | awk '{print $1}')"
echo
log "Done. Backend is live and set to start on every boot."
echo   "  Service : sudo systemctl status $SERVICE_NAME   |   logs: journalctl -u $SERVICE_NAME -f"
if [[ "$MODE" == "lan" ]]; then
  echo "  Health  : http://$SERVER_IP:$PORT/api/health"
  echo
  echo "  Frontend (LAN / HTTP) — in stationery-app/, then rebuild the app:"
  echo "    1) src/environments/environment.ts  ->  apiUrl: 'http://$SERVER_IP:$PORT/api'"
  echo "    2) android/app/src/main/res/xml/network_security_config.xml  ->  add:"
  echo "         <domain includeSubdomains=\"true\">$SERVER_IP</domain>"
  echo "    3) keep capacitor.config.ts server.androidScheme: 'http'"
  echo "    4) npx ng build --configuration development && npx cap sync android && npx cap run android"
  echo "    (give this PC a fixed IP via a router DHCP reservation so $SERVER_IP never changes)"
else
  echo "  Health  : https://$DOMAIN/api/health   (once DNS + port-forwarding 80/443 are set)"
  echo
  echo "  Router  : forward external ports 80 and 443 to this PC ($SERVER_IP)."
  echo "  Frontend (Internet / HTTPS) — in stationery-app/, then rebuild the app:"
  echo "    1) src/environments/environment.prod.ts  ->  apiUrl: 'https://$DOMAIN/api'"
  echo "    2) capacitor.config.ts  ->  remove the server block (or androidScheme: 'https')"
  echo "    3) npx ng build && npx cap sync android && npx cap run android"
fi
echo
