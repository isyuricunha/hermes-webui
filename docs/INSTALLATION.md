# Installation

Hermes WebUI is a sidecar for an **existing Hermes Agent installation** on the same host. It talks to your Hermes gateway and dashboard APIs over loopback.

## Requirements

- Linux (tested on ARM64 and AMD64)
- Node.js 24+ and pnpm 12 (`corepack enable`)
- A running Hermes Agent gateway (`hermes gateway run`) with `API_SERVER_KEY` configured
- The Hermes **dashboard companion** running for Settings features (`hermes dashboard`; see below)

## Install from source

```bash
git clone <this repository>
cd hermes-webui
corepack enable
pnpm install
pnpm build
```

## Configure

Create `apps/server/.env` (see `apps/server/.env.example`):

```bash
HERMES_BASE_URL=http://127.0.0.1:8642     # your gateway
HERMES_API_KEY=<API_SERVER_KEY from your Hermes .env>
HERMES_DASHBOARD_URL=http://127.0.0.1:49173
HERMES_DASHBOARD_SESSION_TOKEN=<shared secret, see below>
HOST=127.0.0.1
PORT=8789
```

### Dashboard companion (Settings features)

Chat works with the gateway alone. Settings (config edits, env/secrets, models, MCP, skills, messaging, doctor) use the official Hermes dashboard API, which must be running:

```bash
systemctl --user enable --now hermes-dashboard.service
```

Give both processes the same session token so the WebUI can authenticate:

```bash
# mint once, never print it
TOKEN=$(openssl rand -hex 32)
mkdir -p ~/.config/systemd/user/hermes-dashboard.service.d
printf '[Service]\nEnvironment=HERMES_DASHBOARD_SESSION_TOKEN=%s\n' "$TOKEN" \
  > ~/.config/systemd/user/hermes-dashboard.service.d/override.conf
chmod 600 ~/.config/systemd/user/hermes-dashboard.service.d/override.conf
systemctl --user daemon-reload && systemctl --user restart hermes-dashboard.service
# then put the same value in apps/server/.env (HERMES_DASHBOARD_SESSION_TOKEN)
```

## Run

### Production

```bash
pnpm build
node apps/server/dist/main.js          # serves the API and the built web UI on :8789
```

Open `http://127.0.0.1:8789`.

### systemd user unit (recommended)

```ini
# ~/.config/systemd/user/hermes-webui.service
[Unit]
Description=Hermes WebUI
After=network-online.target hermes-gateway.service

[Service]
Type=simple
WorkingDirectory=%h/ella-repos/hermes-webui/apps/server
EnvironmentFile=-%h/ella-repos/hermes-webui/apps/server/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
```

> Adjust `WorkingDirectory` to where you cloned the repository and confirm the node path with `command -v node`. Run as the same user as Hermes.

### Development

```bash
pnpm dev        # Fastify on :8789 (tsx watch) + Vite on :5173 with /api proxy
```

## Update policy

The WebUI **never runs `hermes update`**. Update checks are read-only; applying an update through the WebUI is denied unless you explicitly set `HERMES_WEBUI_ALLOW_UPDATE_APPLY=1`. If your Hermes install carries local patches (or any deployment that is not a plain fast-forwardable git checkout), update Hermes through its own flow instead.

## Security notes

- Default bind is loopback (`127.0.0.1`). Exposing the WebUI to a LAN requires adding authentication first (not part of RC1).
- The dashboard companion must stay bound to loopback; its session token is the WebUI's server-side secret.
- See [docs/SECURITY.md](SECURITY.md) for the full model, including CLI bridge controls.
