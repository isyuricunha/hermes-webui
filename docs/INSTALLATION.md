# Installation and deployment

Hermes WebUI runs **next to an existing Hermes Agent**, on the same machine, as the same user. It talks to two Hermes services over loopback:

| Hermes service | Default address | Used for | How to start it |
|---|---|---|---|
| Gateway (API server) | `127.0.0.1:8642` | chat, runs, sessions, cron | `hermes gateway run` (or its service) |
| Dashboard | `127.0.0.1:49173` | sign-in, settings, slash commands, files | `hermes dashboard` (or its service) |

Paths below are relative to the folder you cloned (`hermes-webui/`) unless they start with `~`.

## 1. Requirements

- Linux or macOS (ARM64 and x86-64 both work)
- **Node.js 24+** (`node --version`)
- **pnpm** through Corepack (`corepack enable`, it comes with Node)
- Hermes Agent with the gateway and the dashboard running
- For sign-in mode `hermes` (default): a dashboard username and password, `dashboard.basic_auth` in Hermes' `config.yaml`

Check Hermes before starting:

```bash
curl -s http://127.0.0.1:8642/health        # {"status": "ok", ...}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:49173/   # 200 or 401 means it is up
```

## 2. Install

```bash
git clone https://gitlab.com/isyuricunha/hermes-webui.git
cd hermes-webui
corepack enable
pnpm install
pnpm build
```

`pnpm build` creates `apps/server/dist/` (the server) and `apps/web/dist/` (the app it serves).

## 3. Configure

```bash
cp apps/server/.env.example apps/server/.env
chmod 600 apps/server/.env
```

Edit `apps/server/.env`. Usually only one value needs to change:

```bash
HERMES_API_KEY=<the API_SERVER_KEY value from ~/.hermes/.env>
```

The server reads `.env` from the folder it starts in (`apps/server/`). Real environment variables win over the file.

### Sign-in

The WebUI always asks for a sign-in (cookie session, CSRF protection, rate-limited login).

- **`HERMES_WEBUI_AUTH_MODE=hermes`** (default): use the same username and password as the Hermes dashboard. The WebUI checks them with the dashboard, never stores the password, and keeps the dashboard session on the server for Settings. To change the password, change it in Hermes.
- **`HERMES_WEBUI_AUTH_MODE=local`**: a separate WebUI account. On first start the server writes a one-time setup token to `~/.local/share/hermes-webui/setup-token`; open the app and paste it to create the account. Settings then need a dashboard session token (see [Ungated dashboard](#ungated-dashboard)).

## 4. Run

```bash
pnpm start
```

Open `http://127.0.0.1:8789`. Stop it with `Ctrl+C`.

## Run it as a service

A systemd **user** service starts the WebUI on boot and restarts it if it stops. Create `~/.config/systemd/user/hermes-webui.service` (replace `%h/hermes-webui` if you cloned somewhere else; `%h` is your home folder):

```ini
[Unit]
Description=Hermes WebUI
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/hermes-webui/apps/server
EnvironmentFile=-%h/hermes-webui/apps/server/.env
ExecStart=/usr/bin/env node dist/main.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now hermes-webui
systemctl --user status hermes-webui          # should say active (running)
journalctl --user -u hermes-webui -f          # logs
loginctl enable-linger "$USER"                # keep it running after you log out
```

If `node` is not on the service's PATH (nvm, fnm...), put the full path from `command -v node` in `ExecStart`.

## Reach it from other devices

The WebUI listens on `127.0.0.1` only. Pick one:

- **VPN (simplest):** with Tailscale or WireGuard, set `HOST=0.0.0.0` (or the VPN address) and open `http://<vpn-ip>:8789`. Only devices on your VPN can reach it.
- **HTTPS reverse proxy (Caddy, nginx, Traefik):** keep `HOST=127.0.0.1`, proxy to it, and tell the WebUI to trust the proxy: `HERMES_WEBUI_TRUST_PROXY=127.0.0.1`. With HTTPS you can also install it as an app (PWA) on your phone.

Example with Caddy:

```
webui.example.com {
    reverse_proxy 127.0.0.1:8789
}
```

- **Cloudflare Tunnel (or any tunnel on the same machine):** point the tunnel at `http://127.0.0.1:8789` and make sure the WebUI listens there (keep `127.0.0.1` in `HOST`, e.g. `HOST=<vpn-ip>,127.0.0.1` if you also use a VPN address). Also set `HERMES_WEBUI_TRUST_PROXY=127.0.0.1` so the WebUI sees the tunnel's HTTPS and marks its cookies Secure.

Do not expose it straight to the internet without one of these.

## Update

```bash
cd hermes-webui
git pull
pnpm install
pnpm build
systemctl --user restart hermes-webui     # or run pnpm start again
```

Your data (sign-in sessions, attached files, images you sent) lives outside the repository, in `~/.local/share/hermes-webui/`, so updates never touch it.

## Attached files

Files attached in the chat (audio, video, PDFs, documents...) are saved in `~/.local/share/hermes-webui/uploads/<id>/<name>` and the message tells Hermes that path, exactly like Hermes' Telegram gateway does. Hermes must be able to read that folder, which is true when both run as the same user on the same machine. If Hermes runs in a container, mount a shared folder and point `HERMES_WEBUI_UPLOAD_DIR` at it (same path inside and outside).

## All settings

| Variable | Default | What it does |
|---|---|---|
| `HERMES_API_KEY` | none | Hermes gateway key (`API_SERVER_KEY`) |
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Hermes gateway |
| `HERMES_DASHBOARD_URL` | `http://127.0.0.1:49173` | Hermes dashboard |
| `HERMES_DASHBOARD_SESSION_TOKEN` | none | Only for an ungated dashboard with `local` sign-in |
| `HOST` | `127.0.0.1` | Address the WebUI listens on. Several, comma-separated, are fine: `100.64.0.5,127.0.0.1` serves a VPN address and a tunnel on loopback without opening every interface |
| `PORT` | `8789` | Port the WebUI listens on |
| `HERMES_WEBUI_AUTH_MODE` | `hermes` | `hermes` or `local` sign-in |
| `HERMES_WEBUI_HERMES_AUTH_PROVIDER` | `basic` | Dashboard auth provider used for sign-in |
| `HERMES_WEBUI_DATA_DIR` | `~/.local/share/hermes-webui` | WebUI database and files |
| `HERMES_WEBUI_UPLOAD_DIR` | `<data dir>/uploads` | Where attachments are saved |
| `HERMES_WEBUI_UPLOAD_MAX_MB` | `100` | Largest attachment in MB |
| `HERMES_WEBUI_TRUST_PROXY` | none | Comma-separated IPs/CIDRs of trusted reverse proxies |
| `HERMES_WEBUI_COOKIE_SECURE` | `auto` | `always` to force Secure cookies (TLS ends elsewhere) |
| `HERMES_WEBUI_SESSION_IDLE_HOURS` | `168` | Sign out after this long without use |
| `HERMES_WEBUI_SESSION_ABSOLUTE_DAYS` | `30` | Sign out after this long regardless |
| `HERMES_WEBUI_REAUTH_MINUTES` | `10` | How recent a sign-in must be for sensitive actions |
| `HERMES_BIN` | `hermes` | Hermes command, for the restricted CLI page |
| `HERMES_PYTHON`, `HERMES_SOURCE_DIR` | found automatically | Hermes' Python and source folder (memory/skill approvals); only needed if `hermes --print-runtime-command` does not work |
| `HERMES_WEBUI_ALLOW_UPDATE_APPLY` | unset | `1` lets the System page run `hermes update` (off by default) |
| `WEB_DIST_DIR` | `../web/dist` | Built app folder, relative to `apps/server/` |
| `LOG_LEVEL` | `info` | Server log level |

### Ungated dashboard

Only when the dashboard has no login and you use `local` sign-in: give the dashboard and the WebUI the same random token.

```bash
TOKEN=$(openssl rand -hex 32)       # never print or commit it
mkdir -p ~/.config/systemd/user/hermes-dashboard.service.d
printf '[Service]\nEnvironment=HERMES_DASHBOARD_SESSION_TOKEN=%s\n' "$TOKEN" \
  > ~/.config/systemd/user/hermes-dashboard.service.d/override.conf
chmod 600 ~/.config/systemd/user/hermes-dashboard.service.d/override.conf
echo "HERMES_DASHBOARD_SESSION_TOKEN=$TOKEN" >> apps/server/.env
systemctl --user daemon-reload && systemctl --user restart hermes-dashboard
```

## Troubleshooting

| You see | Try |
|---|---|
| "Hermes: Offline" in the sidebar | The gateway is down or on another port: `curl http://127.0.0.1:8642/health`, check `HERMES_BASE_URL` |
| "Degraded" | Wrong `HERMES_API_KEY` |
| Sign-in fails with the right password | The dashboard is not running, or `dashboard.basic_auth` is not set in Hermes |
| Settings pages say the dashboard session expired | Sign out and sign in again |
| Slash commands say "Hermes commands need the dashboard" | Start the dashboard; commands run through its websocket |
| Attachments: Hermes says it cannot open the file | Hermes cannot read the upload folder; see [Attached files](#attached-files) |
| Blank page after an update | Rebuild (`pnpm build`) and hard-refresh the browser |

## Update policy

The WebUI **never runs `hermes update`** unless you set `HERMES_WEBUI_ALLOW_UPDATE_APPLY=1`. Update checks are read-only. If your Hermes carries local patches, update it through your own flow.

See [SECURITY.md](SECURITY.md) for the security model.
