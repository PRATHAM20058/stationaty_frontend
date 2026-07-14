# Option B — Internet + HTTPS deployment (DuckDNS + Caddy)

This is the **detailed, step-by-step** version of *Option B* from [`DEPLOY_LINUX.md`](./DEPLOY_LINUX.md):
put the Stationery backend on your **Linux Lite** 24×7 PC and reach it from **anywhere** over a
real HTTPS URL like `https://you.duckdns.org/api` — not just on your home Wi-Fi.

**How the pieces fit together**

```
  Phone app (any network)
        │  https://you.duckdns.org/api
        ▼
   DuckDNS  ── resolves the name to your home's public IP
        │
        ▼
  Home router ── forwards ports 80 + 443 to the Linux PC
        │
        ▼
   Caddy (:443)  ── terminates HTTPS with a free Let's Encrypt cert
        │  http://127.0.0.1:3000
        ▼
   Node API (:3000)  ──  MySQL (localhost)
```

Only Caddy is exposed to the internet; Node (3000) and MySQL stay on `localhost`.

> **Why Option B over Option A?** Works on any phone on any network (mobile data, other Wi-Fi),
> uses a trusted HTTPS certificate (no Android cleartext/Mixed-Content workarounds), and matches
> the app's **production** build. The trade-off is more setup (a domain, port-forwarding, a
> reverse proxy) and that the login/signup endpoints become reachable from the internet — so use
> strong secrets (covered in the security section).

---

## Prerequisites checklist

- [ ] Linux Lite PC on 24×7, plugged into your router (Ethernet preferred over Wi-Fi).
- [ ] `sudo` access on that PC.
- [ ] The backend code (`stationery-app/backend/`) copied onto the PC.
- [ ] Admin access to your **home router** (to reserve an IP + forward ports) — *only needed for
      the port-forward path below*.
- [ ] A **public/"real" IP** from your ISP — needed **only** for the DuckDNS + port-forward +
      Caddy path (Steps 2–3, 5–6).

> ### ⚠️ You are behind CGNAT — read this first
> Your ISP uses **CGNAT** (Carrier-Grade NAT), so your router has no public IP and **cannot
> port-forward**. That means **the DuckDNS + port-forward + Caddy path will not work for you**
> — Let's Encrypt and your phone can never reach your router from the internet, no matter how you
> configure it.
>
> **Use the [CGNAT path — expose it with a tunnel](#cgnat-path--expose-it-with-a-tunnel-recommended-for-you) instead.**
> A tunnel makes the server dial *out* to a provider that hands you a public HTTPS URL, so no
> inbound port, no public IP, and no router changes are needed. It's actually **simpler** than the
> port-forward path.
>
> **If you take the tunnel path, do only Steps 1 and 4, then jump to the CGNAT path.**
> **Skip Steps 2, 3, 5, and 6** (no DuckDNS, no port-forwarding, no Caddy — the tunnel replaces
> all three).

---

## Step 1 — Give the Linux PC a fixed LAN IP

Port-forwarding points at a LAN IP, so that IP must never change.

```bash
hostname -I     # current IP, e.g. 192.168.1.50
ip link         # note the MAC of the active interface (e.g. e4:5f:01:aa:bb:cc)
```

On your **router**: DHCP / LAN settings → *Address Reservation* → bind that MAC to a fixed IP
(e.g. `192.168.1.50`). Reconnect and confirm `hostname -I` still shows it. Call this
`<server-ip>` below.

---

## Step 2 — Create your DuckDNS domain

DuckDNS is a free dynamic-DNS service: it maps a name like `you.duckdns.org` to your home's
public IP and keeps it updated when your ISP changes that IP.

1. Go to <https://www.duckdns.org> and sign in (Google/GitHub/etc.).
2. In the **"domains"** box, type a subdomain (e.g. `myshopstore`) and click **add domain**.
   You now own `myshopstore.duckdns.org`.
3. Copy your **token** (shown at the top of the page) — a long UUID. You'll need it for the
   auto-updater.
4. On that row DuckDNS shows the **current IP** it points to. Leave it; the updater in Step 3
   keeps it correct.

Keep two things handy:
- **Domain:** `myshopstore.duckdns.org`
- **Token:**  `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

---

## Step 3 — Install the DuckDNS auto-updater on the Linux PC

Home IPs change periodically; this keeps DuckDNS pointed at the right one. We use a tiny script
run every 5 minutes by a systemd timer.

```bash
sudo tee /usr/local/bin/duckdns-update.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Replace SUBDOMAIN and TOKEN below (SUBDOMAIN = the part before .duckdns.org)
curl -fsS "https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=" -o /dev/null
EOF
sudo nano /usr/local/bin/duckdns-update.sh     # put in your real subdomain + token
sudo chmod 700 /usr/local/bin/duckdns-update.sh

# systemd service + timer (runs at boot, then every 5 min)
sudo tee /etc/systemd/system/duckdns.service >/dev/null <<'EOF'
[Unit]
Description=DuckDNS IP updater
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/duckdns-update.sh
EOF

sudo tee /etc/systemd/system/duckdns.timer >/dev/null <<'EOF'
[Unit]
Description=Run DuckDNS updater every 5 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now duckdns.timer
sudo /usr/local/bin/duckdns-update.sh          # run once now
```

Verify it worked: the DuckDNS website row should show your current public IP, and:

```bash
dig +short myshopstore.duckdns.org             # should print your public IP
# (install dig with: sudo apt install -y dnsutils)
```

> **Automated alternative:** `deploy-linux.sh --mode https --domain myshopstore.duckdns.org --duckdns-token <TOKEN>`
> sets up this exact updater (Steps 3, 7, 8) for you. Steps 1, 2, 4, 5 you still do by hand.

---

## Step 4 — Install Node.js, MySQL, and the backend

Same as the LAN guide — do steps **2, 3, 4** of [`DEPLOY_LINUX.md`](./DEPLOY_LINUX.md):
install Node 20, install/secure MySQL, create the `stationery` DB + user, copy the code to
`~/backend`, write `.env`, then `npm ci && npm run seed`.

Your `.env` is identical to the LAN case (CORS does **not** depend on the domain — the phone's
webview origin is always `https://localhost`):

```
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=stationery
DB_PASSWORD=CHANGE_ME_STRONG
DB_NAME=stationery
JWT_SECRET=paste-a-long-random-string-here
JWT_EXPIRES_IN=30d
CORS_ORIGINS=http://localhost:8100,capacitor://localhost,http://localhost,https://localhost
```

Quick local check before exposing it:

```bash
cd ~/backend && npm start
curl http://localhost:3000/api/health     # -> {"status":"ok"}   (Ctrl+C to stop)
```

Then make it a 24×7 systemd service — do step **5** of `DEPLOY_LINUX.md` (the
`backend.service` unit). Confirm:

```bash
sudo systemctl status backend             # active (running)
```

> **Firewall note (differs from LAN):** you do **not** need to open port 3000 to the internet.
> Caddy (installed next) talks to Node on `localhost`. Open only 80 + 443:
> ```bash
> sudo apt install -y ufw
> sudo ufw allow 80/tcp
> sudo ufw allow 443/tcp
> sudo ufw enable
> ```
> (Optionally also `sudo ufw allow 3000/tcp` if you still want direct LAN access on `:3000`.)

---

## Step 5 — Forward ports 80 and 443 on your router  *(port-forward path only — skip if behind CGNAT)*

Let's Encrypt (used by Caddy) must reach your server to issue the certificate, and the phone
must reach it to use the API.

On your **router**: *Port Forwarding* / *Virtual Server* → add two rules pointing at
`<server-ip>` (your Linux PC):

| Name        | External port | Internal IP   | Internal port | Protocol |
|-------------|---------------|---------------|---------------|----------|
| http-caddy  | 80            | `<server-ip>` | 80            | TCP      |
| https-caddy | 443           | `<server-ip>` | 443           | TCP      |

Save/apply. (Some routers also need you to disable a built-in "remote management on port 80/443"
setting so it doesn't grab those ports.)

---

## Step 6 — Install Caddy (automatic HTTPS reverse proxy)

Caddy fetches and auto-renews a free Let's Encrypt certificate, and reverse-proxies HTTPS to your
Node app.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Configure the reverse proxy — **use your real domain**:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
myshopstore.duckdns.org {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl restart caddy
sudo systemctl enable caddy
```

Watch it obtain the certificate (first time takes a few seconds):

```bash
journalctl -u caddy -f      # look for "certificate obtained successfully"; Ctrl+C to exit
```

If certificate issuance fails, it's almost always **DNS not yet pointing at you** (Step 3) or
**ports 80/443 not forwarded** (Step 5). Fix those, then `sudo systemctl restart caddy`.

---

## Step 7 — Verify HTTPS end to end

From **any** device (even mobile data, off your home Wi-Fi):

```
https://myshopstore.duckdns.org/api/health     # -> {"status":"ok"}
```

A green padlock / valid certificate means Caddy + DuckDNS + forwarding all work. You're ready to
point the app at it.

---

## Step 8 — Frontend change (required, then rebuild the app)

The server URL is **compiled into the APK**, so you must set it and rebuild once. For Option B the
app uses the **production** environment:

1. `stationery-app/src/environments/environment.prod.ts`:
   ```ts
   apiUrl: 'https://myshopstore.duckdns.org/api',
   ```
2. `stationery-app/capacitor.config.ts` — remove the `server` block (or set
   `androidScheme: 'https'`). HTTPS page → HTTPS API means **no cleartext config and no
   Mixed-Content issue**, so the emulator-only `http` scheme and the
   `network_security_config.xml` IP entry are **not** needed here.
3. Build the **production** app and install it on the phone:
   ```bash
   cd stationery-app
   npx ng build                 # defaults to the production configuration
   npx cap sync android
   npx cap run android          # or assemble a release APK and install it
   ```

Now the app works on **any phone, on any network**. `admin` / `admin123` is seeded on the server;
new users can sign up and each sees only their own data.

> **CORS:** no change. The webview origin is `https://localhost`, already in `CORS_ORIGINS`.

---

## Maintenance

```bash
# backend
sudo systemctl restart backend
journalctl -u backend -f

# caddy / certs (auto-renew; nothing to do normally)
sudo systemctl status caddy
journalctl -u caddy -f

# duckdns updater
systemctl status duckdns.timer
journalctl -u duckdns.service -n 20

# code update
cd ~/backend && git pull && npm ci && npm run seed && sudo systemctl restart backend

# db backup
mysqldump -u stationery -p stationery > ~/stationery-backup-$(date +%F).sql
```

---

## Security (matters now that it's on the internet)

Once reachable from the internet, anyone can hit `/auth/login` and `/auth/signup`. Reduce risk:

- **Change the default admin password** immediately (log in as `admin`/`admin123`, then create a
  new owner account and stop using the default — or change admin's password in the DB).
- Use a **long random `JWT_SECRET`** (the `.env` example command generates one).
- Keep the OS and packages patched: `sudo apt update && sudo apt upgrade`.
- Consider **fail2ban** or a rate-limit in front of `/auth/*` if you expect abuse.
- Only ports **80/443** are exposed; keep **3000** and **MySQL** on `localhost` only (default).
- Caddy auto-renews the TLS cert; no action needed, but check `journalctl -u caddy` occasionally.

---

## CGNAT path — expose it with a tunnel (recommended for you)

Because your ISP uses **CGNAT**, inbound connections (port-forwarding) are impossible. A **tunnel**
solves this cleanly: a small agent on the Linux PC makes an **outbound** connection to a provider,
and the provider gives you a public **HTTPS** URL that routes back down that connection to your
Node app. No public IP, no open ports, no router changes, and TLS is handled for you — so you also
**don't need DuckDNS or Caddy**.

```
  Phone app (any network)
        │  https://<your-tunnel-hostname>/api
        ▼
  Tunnel provider (Cloudflare / Tailscale)  ── public HTTPS + certificate
        ▲   (outbound connection, started by the PC — passes straight through CGNAT)
        │
   Tunnel agent on the Linux PC  ── http://127.0.0.1:3000
        ▼
   Node API (:3000)  ──  MySQL (localhost)
```

Do **Step 1** (fixed LAN IP is still nice, though not strictly required for a tunnel) and
**Step 4** (Node + MySQL + backend + the `backend` systemd service), then pick **one** of the two
tunnels below. Both are free for personal use and both survive reboots.

> After either tunnel is up, your firewall only needs to allow **outbound** traffic (the default).
> You can leave 80/443 **closed**. Keep Node (3000) and MySQL on `localhost`.

### Option 1 — Tailscale Funnel (no domain needed — simplest for you)

Gives a stable public URL like `https://<machine>.<tailnet>.ts.net` with automatic HTTPS. Best if
you **don't own a domain** (which is likely, since you were using free DuckDNS).

1. Create a free account at <https://tailscale.com> (sign in with Google/GitHub/etc.).
2. Install and connect on the Linux PC:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up          # opens/prints a login URL — authenticate in a browser
   ```
3. In the **admin console** (<https://login.tailscale.com/admin>):
   - **DNS** page → enable **MagicDNS** and **HTTPS Certificates**.
   - **Access controls / Funnel** → allow Funnel for this machine (the CLI in the next step will
     print an enable link if it isn't on yet).
4. Find your machine's public hostname:
   ```bash
   tailscale status            # your node is <machine>.<tailnet>.ts.net
   ```
5. Expose the API (port 3000) over Funnel, persistently:
   ```bash
   sudo tailscale funnel --bg 3000
   sudo tailscale funnel status   # should show https://<machine>.<tailnet>.ts.net -> 127.0.0.1:3000
   ```
   `tailscaled` runs as a service and the `--bg` funnel config persists, so this comes back after
   a reboot.
6. Verify from **any** network (mobile data):
   ```
   https://<machine>.<tailnet>.ts.net/api/health   # -> {"status":"ok"}
   ```
7. **Frontend:** set `apiUrl` to that URL and rebuild (see "Frontend for the tunnel" below).

### Option 2 — Cloudflare Tunnel (if you own / can get a domain)

Gives a nice URL like `https://api.yourdomain.com`. Requires a domain added to a (free) Cloudflare
account. More "production-grade"; pick this if you have a domain.

1. Add your domain to Cloudflare (free plan) and switch its nameservers to Cloudflare.
2. Install `cloudflared` on the Linux PC:
   ```bash
   curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
     | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt install -y cloudflared
   ```
3. Authenticate and create the tunnel:
   ```bash
   cloudflared tunnel login                 # pick your domain in the browser
   cloudflared tunnel create stationery     # prints a tunnel UUID + credentials file path
   cloudflared tunnel route dns stationery api.yourdomain.com
   ```
4. Configure `/etc/cloudflared/config.yml` (use your UUID + credentials path):
   ```yaml
   tunnel: <TUNNEL-UUID>
   credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json
   ingress:
     - hostname: api.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```
5. Run it 24×7 as a service:
   ```bash
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```
6. Verify:
   ```
   https://api.yourdomain.com/api/health    # -> {"status":"ok"}
   ```
7. **Frontend:** set `apiUrl` to `https://api.yourdomain.com/api` and rebuild.

### Frontend for the tunnel (same idea as Step 8)

Whichever tunnel you chose, point the app at its HTTPS URL and rebuild once:

1. `stationery-app/src/environments/environment.prod.ts`:
   ```ts
   apiUrl: 'https://<your-tunnel-hostname>/api',   // ts.net or your Cloudflare hostname
   ```
2. `stationery-app/capacitor.config.ts` — remove the `server` block (or `androidScheme: 'https'`);
   no cleartext config needed (it's HTTPS).
3. `cd stationery-app && npx ng build && npx cap sync android && npx cap run android`

That's it — the app now works on **any phone, on any network**, straight through CGNAT.

> **Security:** the tunnel exposes `/auth/login` and `/auth/signup` to the internet, same as the
> port-forward path — apply the [Security](#security-matters-now-that-its-on-the-internet)
> section (change the default admin password, strong `JWT_SECRET`, keep things patched).

---

*See [`DEPLOY_LINUX.md`](./DEPLOY_LINUX.md) for the LAN (Option A) path and the automated
`deploy-linux.sh` script that performs the server-side steps for either option.*
