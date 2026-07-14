# Deploying the Stationery Backend on a Linux Lite 24×7 Home Server

This guide deploys the Node.js + Express + MySQL backend (`stationery-app/backend/`) onto a
**Linux Lite** PC that stays on and connected to your router 24×7, so your phone (and other
devices) on the same network can sync against it any time.

Linux Lite is Ubuntu-LTS based, so everything below uses `apt`, `systemd`, and `ufw`.

> **Two ways to expose it — pick one:**
> - **Option A — LAN only (HTTP).** Simplest. The app talks to the server over your local
>   network at `http://<server-ip>:3000`. Works only while the phone is on the same Wi-Fi.
> - **Option B — Internet + HTTPS (DuckDNS + reverse proxy).** Reach it from anywhere over
>   `https://<you>.duckdns.org`. More setup, but no cleartext/Mixed-Content issues and works
>   off your home network. See the last section.
>
> Most home setups want **Option A**. The frontend changes differ per option — see
> "Frontend changes" at the end.

---

## Quick path — automated script (`deploy-linux.sh`)

The whole server-side setup (steps 2–8 below) is automated by **`deploy-linux.sh`** in this
folder. Copy the `backend/` folder onto the Linux PC, `cd` into it, and run it with `sudo`:

```bash
# Option A — LAN over HTTP:
sudo ./deploy-linux.sh --mode lan

# Option B — Internet + HTTPS (Caddy handles the certificate; DuckDNS token is optional):
sudo ./deploy-linux.sh --mode https --domain you.duckdns.org --duckdns-token <YOUR_TOKEN>
```

It installs Node.js + MySQL, creates the DB/user, writes `.env` (generating a random
`JWT_SECRET` and DB password if you don't pass one), installs deps, seeds the schema + admin,
and registers a **systemd** service so the API runs 24×7 and restarts on boot/crash. For
`--mode https` it also installs **Caddy** (automatic Let's Encrypt HTTPS) and, if given a
DuckDNS token, a DuckDNS auto-updater. It's **idempotent** — safe to re-run after a code update
(`git pull && sudo ./deploy-linux.sh --mode …` then it re-seeds and restarts).

When it finishes it prints the exact **frontend changes** for your chosen mode (with your real
server IP / domain filled in) plus the health-check URL. Run `./deploy-linux.sh --help` for all
flags (`--db-pass`, `--port`, `--node-major`).

> Still do **step 1 (fixed LAN IP)** yourself on the router — the script can't set that. The
> sections below are the manual, step-by-step equivalent if you'd rather not use the script or
> want to understand each piece.

---

## 0. Before you start

You need, on the Linux Lite PC:
- Terminal access (and `sudo`).
- The backend code (`stationery-app/backend/`). Either `git clone` your repo or copy the
  `backend/` folder over with a USB stick / `scp`.

Decide a folder to run it from, e.g. `/opt/backend` or `~/backend`.
This guide uses `~/backend`.

---

## 1. Give the server a fixed LAN IP (important)

The phone app has the server address **compiled into it**, so the server's IP must not change.

Easiest: **DHCP reservation on your router**
1. Find the PC's current IP and MAC on the Linux box:
   ```bash
   hostname -I          # e.g. 192.168.1.50
   ip link              # note the MAC (e.g. e4:5f:01:...) of your active interface
   ```
2. Log into your router admin page → DHCP / LAN settings → "Address Reservation" (name varies)
   → bind that MAC to a fixed IP (e.g. `192.168.1.50`).
3. Reboot the PC (or reconnect) and confirm `hostname -I` still shows that IP.

Write this IP down — you'll use it as `<server-ip>` everywhere below.

---

## 2. Install Node.js 20 LTS

Ubuntu's default `apt` Node is often too old, so use NodeSource:

```bash
sudo apt update
sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # should print v20.x (or newer)
npm --version
```

---

## 3. Install and secure MySQL 8

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql     # start now + on every boot
sudo mysql_secure_installation        # set a root password, answer Y to the hardening prompts
```

Create the database and a dedicated app user (pick a real password):

```bash
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS stationery CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stationery'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG';
GRANT ALL PRIVILEGES ON stationery.* TO 'stationery'@'localhost';
FLUSH PRIVILEGES;
SQL
```

> The app connects to MySQL only on `localhost`, so MySQL does **not** need to be exposed on the
> network — leave it bound to `127.0.0.1` (the Ubuntu default). Only the Node app's port (3000)
> is opened to the LAN.

---

## 4. Get the code and configure `.env`

```bash
# option 1: clone your repo
git clone <your-repo-url> ~/stationery-src
cp -r ~/stationery-src/stationery-app/backend ~/backend
# option 2: just copy the backend/ folder here by USB/scp, into ~/backend

cd ~/backend
cp .env.example .env
nano .env
```

Set `.env` like this (match the DB password from step 3, and generate a long random JWT secret):

```
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=stationery
DB_PASSWORD=CHANGE_ME_STRONG
DB_NAME=stationery
JWT_SECRET=paste-a-long-random-string-here
JWT_EXPIRES_IN=30d
# The Capacitor webview origin is http://localhost (Android) — keep these:
CORS_ORIGINS=http://localhost:8100,capacitor://localhost,http://localhost,https://localhost
```

Generate a strong `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Install dependencies and create the schema + admin account:

```bash
npm ci        # or: npm install
npm run seed  # creates tables + seeds admin/admin123 (idempotent; also runs on boot)
```

Quick manual test before making it a service:
```bash
npm start
# in another terminal on the same PC:
curl http://localhost:3000/api/health      # -> {"status":"ok"}
```
Press `Ctrl+C` to stop, then continue to step 5.

---

## 5. Run it 24×7 with systemd (auto-start on boot, auto-restart on crash)

Create a service unit:

```bash
sudo nano /etc/systemd/system/backend.service
```

Paste (replace `YOUR_USER` with your Linux username, and fix the path if different):

```ini
[Unit]
Description=Stationery Shop Backend (Node/Express)
After=network-online.target mysql.service
Wants=network-online.target
Requires=mysql.service

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
# dotenv reads .env from WorkingDirectory, so no EnvironmentFile needed.
# Optional hardening:
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now backend
sudo systemctl status backend       # should say "active (running)"
journalctl -u backend -f            # live logs (Ctrl+C to exit)
```

Now the backend starts automatically on every boot and restarts if it ever crashes.

---

## 6. Open the firewall for port 3000 (LAN)

```bash
sudo apt install -y ufw
sudo ufw allow 3000/tcp
sudo ufw enable        # if the firewall wasn't already on
sudo ufw status
```

---

## 7. Verify from another device

From your phone's browser (on the same Wi-Fi), or from your Mac:

```
http://<server-ip>:3000/api/health      # e.g. http://192.168.1.50:3000/api/health
```

You should see `{"status":"ok"}`. If that works, the app can reach it too (after the frontend
changes below).

---

## 8. Maintenance cheatsheet

```bash
sudo systemctl restart backend     # restart after a code/.env change
sudo systemctl stop backend        # stop
journalctl -u backend -n 100       # last 100 log lines
journalctl -u backend -f           # follow logs

# updating the code:
cd ~/backend
git pull            # or re-copy files
npm ci              # if dependencies changed
npm run seed        # safe to re-run; applies any new migrations
sudo systemctl restart backend

# database backup (run on a schedule / before updates):
mysqldump -u stationery -p stationery > ~/stationery-backup-$(date +%F).sql
```

---

## Frontend changes (required — the app must be rebuilt)

The server address is **baked into the compiled app**, so pointing the phone at the Linux server
means editing the frontend config and **rebuilding + reinstalling** the app. The exact change
depends on which option you chose.

> These are in the `stationery-app/` frontend (not the backend). File paths are relative to
> `stationery-app/`.

### If you chose Option A — LAN over HTTP

1. **API URL** — `src/environments/environment.ts`:
   ```ts
   apiUrl: 'http://<server-ip>:3000/api',   // e.g. http://192.168.1.50:3000/api
   ```
   (This is the **dev** config used by `--configuration development`. If you build a
   **production** APK instead, put the same value in `environment.prod.ts`.)

2. **Allow cleartext HTTP to that IP** — Android blocks plain `http://` by default. Add the
   server IP to `android/app/src/main/res/xml/network_security_config.xml`:
   ```xml
   <domain includeSubdomains="true">192.168.1.50</domain>
   ```
   (alongside the existing entries). And the webview must serve over http —
   `capacitor.config.ts` should keep `server.androidScheme: 'http'` (already set).

3. **Rebuild + reinstall** the app:
   ```bash
   cd stationery-app
   npx ng build --configuration development
   npx cap sync android
   npx cap run android          # or build an APK and install it on the phone
   ```

4. The phone must be on the **same Wi-Fi/LAN** as the Linux server, and the server needs a
   **fixed IP** (step 1) or the URL will break when the IP changes.

### If you chose Option B — Internet + HTTPS (DuckDNS)

1. **API URL** — use your HTTPS domain in `src/environments/environment.prod.ts` (production
   builds already point here):
   ```ts
   apiUrl: 'https://<you>.duckdns.org/api',
   ```
2. **No cleartext config needed** and **no Mixed-Content issue** (HTTPS page → HTTPS API), so you
   can leave `androidScheme` at its secure default (remove the `server` block from
   `capacitor.config.ts`, or set `androidScheme: 'https'`).
3. **Rebuild** with the production config: `npx ng build` (defaults to production) →
   `npx cap sync android` → build/install.
4. Works from any network, not just home Wi-Fi.

### Backend CORS (either option)
No change needed. The Capacitor Android webview's request `Origin` is `http://localhost`
(or `https://localhost`), which is already in `CORS_ORIGINS`. It does **not** depend on the
server's IP or domain.

---

## Optional — Option B in detail (reach it from anywhere with HTTPS)

For access outside your home network with a real certificate:

1. **DuckDNS** — register a free subdomain at <https://www.duckdns.org>, point it at your home's
   public IP, and install their updater on the Linux PC (a cron/systemd-timer that keeps the DNS
   record current when your ISP changes your IP).
2. **Port forwarding** — on your router, forward external ports 80 and 443 to the Linux PC's
   fixed LAN IP.
3. **Reverse proxy with automatic HTTPS** — the simplest is **Caddy**, which fetches a Let's
   Encrypt certificate for you:
   ```bash
   # install Caddy (see https://caddyserver.com/docs/install), then:
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   your-name.duckdns.org {
       reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl restart caddy
   ```
   Caddy terminates HTTPS on 443 and forwards to the Node app on 3000. You do **not** need to
   open port 3000 to the internet in this case (only 80/443 via the router).
4. Point the app at `https://your-name.duckdns.org/api` (Option B frontend steps above).

> Security note: exposing a service to the internet means anyone can reach `/auth/login` and
> `/auth/signup`. Use a strong `JWT_SECRET`, strong account passwords, and keep the OS/Node/MySQL
> updated. For LAN-only use (Option A), this risk doesn't apply.
