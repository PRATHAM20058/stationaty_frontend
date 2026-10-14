# Subsystem Architecture: Deployment, Packaging & Operations

This document provides complete operational guides for local development, Android APK compilation and signing, 24×7 Linux server deployment, CGNAT tunnel configuration, and database disaster recovery.

---

## 1. Prerequisites Matrix

| Subsystem | Requirement | Notes |
| :--- | :--- | :--- |
| **Node.js** | 20.x LTS or 22+ | Required for Angular 20 compiler and modern ES features |
| **Ionic CLI** | `@ionic/cli` (Global) | Install via `npm install -g @ionic/cli` |
| **Java JDK** | **JDK 21** (Temurin recommended) | **Mandatory** for `@capacitor/filesystem` Android module |
| **Android SDK** | API Level 34+ / Build Tools 34.0.0+ | Installed via Android Studio |
| **Database** | MySQL 8.0+ | Local Homebrew on Mac or `mysql-server` on Linux |
| **Reverse Proxy** | Caddy or Cloudflare / Tailscale | For TLS termination and public routing |

---

## 2. Local Development Workflows

### A. Running the Web Application
```bash
# Terminal 1: Backend API
cd stationery-app/backend
npm install
npm run seed     # Ensures DB schema & default admin user exist
npm run dev      # Boots server with nodemon at http://localhost:3000/api

# Terminal 2: Ionic Frontend
cd stationery-app
npm install
ionic serve      # Serves web PWA at http://localhost:8100
```

> **Web SQLite Note**: The browser uses `jeep-sqlite` (WASM over IndexedDB). If login hangs or console throws `LinkError: WebAssembly.instantiate()`, verify that `src/assets/sql-wasm.wasm` matches `sql.js@1.11.0` (see Troubleshooting below).

---

## 3. Android Packaging, Compilation & Signing

Capacitor compiles the web assets into a native Android Studio Gradle project located at [**`stationery-app/android/`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/android).

### A. Syncing Web Assets to Native Project
```bash
cd stationery-app
ionic build --prod
npx cap sync android
```

### B. Building a Debug APK
```bash
cd stationery-app/android
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # Ensure JDK 21 on macOS
./gradlew assembleDebug

# Output APK:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### C. Building a Signed Release APK
Release signing is pre-configured in `android/app/build.gradle` pointing to the bundled keystore:

```bash
cd stationery-app
ionic build --prod
npx cap sync android
cd android
./gradlew assembleRelease

# Output signed APK:
# android/app/build/outputs/apk/release/app-release.apk
```

To install directly to a connected phone or emulator via ADB:
```bash
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.mystore.stationery/.MainActivity
```

---

## 4. 24×7 Linux Server Deployment (`systemd`)

The backend is designed to run indefinitely on a low-power home PC (e.g., Linux Lite, Ubuntu Server, Raspberry Pi).

### Quick Path: Automated Deployer (`deploy-linux.sh`)
The bundled script [**`stationery-app/backend/deploy-linux.sh`**](file:///Users/parmarpratham/Desktop/mystore/stationery-app/backend/deploy-linux.sh) automates package installation, MySQL user creation, `.env` generation, database seeding, and systemd service registration.

```bash
# Option A: LAN Only (HTTP)
sudo ./deploy-linux.sh --mode lan

# Option B: Internet + HTTPS (Caddy)
sudo ./deploy-linux.sh --mode https --domain you.duckdns.org --duckdns-token <TOKEN>
```

### Manual Systemd Service Configuration
File path: `/etc/systemd/system/backend.service`

```ini
[Unit]
Description=Stationery Shop Backend API (Node.js/Express)
After=network-online.target mysql.service
Wants=network-online.target
Requires=mysql.service

[Service]
Type=simple
User=stationery
WorkingDirectory=/home/stationery/backend
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now backend
sudo systemctl status backend
```

---

## 5. Networking Strategies & Operating Behind CGNAT

Connecting client devices to the backend depends on your home network topology:

```
                            Network Topologies
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
         Local LAN Only                        Internet Access
      (Phone on same Wi-Fi)              (Access from Mobile Data / WAN)
               │                                         │
        Option A (LAN)                                   │
      http://192.168.1.50:3000                           │
                                        ┌────────────────┴────────────────┐
                                        ▼                                 ▼
                               Public IP Available               Behind CGNAT (No Inbound)
                                        │                                 │
                                 Option B (Caddy)                  Tunnel Solutions
                             DuckDNS + Port Forward 80/443                │
                                                         ┌────────────────┴────────────────┐
                                                         ▼                                 ▼
                                                Tailscale Funnel                   Cloudflare Tunnel
                                            (kali-pc.ts.net/api)                 (api.yourdomain.com)
```

### Option A: LAN Only (HTTP)
- **Use Case**: Phone operates exclusively on the shop Wi-Fi network.
- **Config**: Set `apiUrl: 'http://<server-ip>:3000/api'` in `src/environments/environment.ts`.
- **Android Cleartext Requirement**: Plain `http://` requires adding the server IP to `android/app/src/main/res/xml/network_security_config.xml` and setting `androidScheme: 'http'` in `capacitor.config.ts`.

### Option B: DuckDNS + Caddy Reverse Proxy (Public HTTPS)
- **Use Case**: Server has a real public IP (non-CGNAT), and router ports 80/443 can be forwarded.
- **Reverse Proxy**: Caddy automatically provisions Let's Encrypt certificates:
  ```caddyfile
  myshop.duckdns.org {
      reverse_proxy 127.0.0.1:3000
  }
  ```

### Option C: Operating Behind ISP CGNAT (Carrier-Grade NAT)
> [!IMPORTANT]
> If your ISP uses CGNAT (typical for residential cellular/fiber), port-forwarding is blocked. Inbound requests will never reach your router. You must use an **outbound tunnel**.

#### Method 1: Tailscale Funnel (Currently Active in Codebase)
*Configured in `environment.ts` and `environment.prod.ts` (`https://kali-pc.tail0f71f2.ts.net/api`)*:
1. Install Tailscale on the Linux host:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
2. Enable MagicDNS, HTTPS Certificates, and Funnel in the Tailscale admin console.
3. Expose port 3000 via background funnel:
   ```bash
   sudo tailscale funnel --bg 3000
   ```
4. Provides a persistent public HTTPS endpoint with automatic TLS certificates without opening router ports.

#### Method 2: Cloudflare Tunnel (`cloudflared`)
1. Create a tunnel in the Cloudflare Zero Trust dashboard.
2. Route public hostname (e.g., `api.stationeryshop.com`) to `http://localhost:3000`.

---

## 6. Database Backup & Disaster Recovery

### Automatic Daily Backup (Cron)
Add to server crontab (`crontab -e`):
```bash
# Backup MySQL database every night at 2:00 AM
0 2 * * * mysqldump -u stationery -p'YOUR_PASSWORD' stationery | gzip > /var/backups/stationery-$(date +\%F).sql.gz
```

### Manual Restoration
```bash
gunzip < /var/backups/stationery-2026-10-14.sql.gz | mysql -u stationery -p stationery
```

---

## 7. Known Production Caveats & Troubleshooting

### 1. Web Assembly `LinkError` on Web Build
- **Symptom**: Web login freezes; browser console reports `LinkError: WebAssembly.instantiate() ... "I": function import requires a callable`.
- **Cause**: Version mismatch between `jeep-sqlite` and `src/assets/sql-wasm.wasm`.
- **Fix**: Re-align the WASM asset with `sql.js@1.11.0`:
  ```bash
  npm pack sql.js@1.11.0 && tar -xzf sql.js-1.11.0.tgz
  cp package/dist/sql-wasm.wasm src/assets/sql-wasm.wasm
  rm -rf package sql.js-1.11.0.tgz
  ```

### 2. Gradle Java Toolchain Failure
- **Symptom**: `./gradlew assembleRelease` errors with `Cannot find a Java installation matching JDK 21`.
- **Fix**: Install Eclipse Temurin JDK 21 and export `JAVA_HOME`:
  ```bash
  brew install --cask temurin@21
  export JAVA_HOME=$(/usr/libexec/java_home -v 21)
  ```

### 3. Mixed Content Block on Android Webview
- **Symptom**: Android app cannot make API calls to a LAN `http://` server.
- **Fix**: Verify `capacitor.config.ts` includes `server: { androidScheme: 'http' }` and `network_security_config.xml` includes `<domain includeSubdomains="true">YOUR_SERVER_IP</domain>`.
