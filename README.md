# TeamSphere

A self-hosted team collaboration platform for internal company use: chat, teams & channels, audio/video calls
(1:1 and group), meetings, files, and more, delivered as a **web app** and a **Windows desktop app**.

> Scope, architecture, data model, and the phase plan live in **[SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md)**.
> Read it before making design changes, and record changes in its change log.

## Roadmap & status

Legend: ✅ done · 🚧 in progress · ⏳ not started · ⏸ deferred · ❌ out of scope.
Full feature lists per area are in [SOURCE_OF_TRUTH.md §3](SOURCE_OF_TRUTH.md); exit criteria per phase in §9.

| # | Phase | Status | What it covers |
|---|---|---|---|
| 0 | Foundation | ✅ | pnpm monorepo, Docker dev infra, Prisma, auth (username/password, Microsoft Entra ID, on-prem AD/LDAP), sessions & devices, profile, presence, app shell, settings, basic user admin |
| 0.5 | Windows desktop shell | ✅ | Electron app, NSIS + MSI installers, tray + status menu, Windows toasts (incl. call toast), screen picker, taskbar badge, deep links, idle → Away, auto-update |
| 1 | Chat & presence | 🚧 | **Done:** 1:1/group/self chats, realtime delivery, formatting, @mentions, reply, edit/delete, reactions, typing, Seen, unread, attachments, importance, pin/mute, members, Activity feed, notifications. **To do:** scheduled send, saved messages, mark unread, chat folders, polls, voice clips, link previews, pop-out chat, urgent re-notify, in-chat search, avatar upload, status expiry UI, out-of-office |
| 2 | Teams & channels | ⏳ | Teams (public/private/org-wide), standard/private/shared channels, threaded posts, @team/@channel/@tags, announcements, moderation, channel tabs, wiki, archive |
| 3 | Calling | ✅ | LiveKit 1:1 & group audio/video, ringing (accept / audio-only / decline, 30 s timeout → missed call), screen share, mute/camera, device settings + test, network quality, reconnect, audio-only fallback, add people, hold/resume, blind transfer, forwarding & simultaneous ring, internal voicemail, busy-on-busy & DND rejection, call history & call back, speed dial, "In a call" presence. **Later:** consult transfer, call groups/delegation, E2EE (P2) |
| 4 | Desktop integration | ⏳ | Wire desktop shell into chat & calls: call toast actions, mute/camera shortcuts, mini call window |
| 5 | Meetings & calendar | ⏳ | Scheduling, calendar views, scheduling assistant, lobby, roles, recording, breakout rooms, whiteboard, polls, attendance, guest join |
| 6 | Files | ⏳ | Personal & team libraries, folders, versions, sharing links, recycle bin |
| 7 | Search, admin & settings | ⏳ | Global search, command box, admin center, policies, audit log UI, themes/shortcuts |
| 8 | Productivity apps | ⏳ | Planner/To Do, Approvals, Lists, Pages/Loop/wiki, Forms, Whiteboard app, Stream |
| 9 | Office co-editing & Premium meetings | ⏳ | ONLYOFFICE, watermark, branding, E2EE, meeting templates, Q&A, PDF presenting, together/large gallery |
| 10 | Events | ⏳ | Webinars, town halls (HLS), Bookings & virtual appointments |
| 11 | Frontline & community | ⏳ | Shifts, Updates, Walkie Talkie, Community feed, Praise |
| 12 | Platform & compliance | ⏳ | Webhooks, bots, cards, app catalog, workflows, retention, eDiscovery, legal hold, info barriers, DLP |
| — | Live captions, AI features | ⏸ | Deferred (future enhancement) |
| — | PSTN phone numbers, mobile apps, macOS/Linux desktop | ❌ | Out of scope |

---

## Resuming work on another device (Claude Code / Claude desktop app)

Everything Claude needs is in the repo, not in chat history:

- **[CLAUDE.md](CLAUDE.md)**: loaded automatically by Claude Code. It covers the project rules, how to run things, known gotchas, and where to pick up.
- **[SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md)**: spec, decisions, phase plan and change log.
- **This README**: setup steps and the roadmap above.

To resume:

1. Install the prerequisites (§1) and follow the local setup (§2) on the new machine.
2. Open the cloned folder in Claude Code (CLI, desktop app Code tab, or IDE extension).
3. Tell Claude, for example: *"Read CLAUDE.md and SOURCE_OF_TRUTH.md, then continue with the next unfinished item in the roadmap."*
4. When a phase or item is finished, update the roadmap table above, the phase table in SOURCE_OF_TRUTH §9, and its change log, then commit and push.

---

## Repository layout

```
apps/
  api/        NestJS REST API (+ WebSocket gateway from Phase 1), Prisma ORM
  web/        Next.js 15 web app (also loaded by the desktop app)
  desktop/    Electron shell for Windows (installers, tray, notifications, screen picker…)
packages/
  shared/     Types, zod schemas and event names shared by all apps
infra/
  docker-compose.yml   Dev services: PostgreSQL, Redis, S3 storage (SeaweedFS), LiveKit, Mailpit
SOURCE_OF_TRUTH.md     Product spec & architecture (single source of truth)
```

## Tech stack

Next.js 15 · React 19 · Tailwind CSS 4 · TanStack Query · Zustand · NestJS 11 · Prisma 6 · PostgreSQL 16 ·
Redis 7 · Socket.IO · LiveKit (self-hosted SFU) · SeaweedFS (S3 API) · Electron 44 · pnpm workspaces.

---

## 1. Prerequisites (all platforms)

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | **22 LTS or newer** (developed on 24) | `node -v` |
| pnpm | **10+** (developed on 12) | `pnpm -v` |
| Docker + Docker Compose | Docker Desktop 4.x / Engine 24+ | `docker compose version` |

Install pnpm (any OS) after Node.js:

```bash
npm install -g pnpm
```

### Windows 10/11

1. Install [Git for Windows](https://git-scm.com/download/win), [Node.js LTS](https://nodejs.org/), and
   [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL 2 backend).
2. Start Docker Desktop and wait until it shows "Engine running".
3. Use **PowerShell** or **Git Bash** for the commands below.
4. Recommended: ask IT to add a Microsoft Defender exclusion for your code folder (for example `D:\CODES`).
   Real-time scanning of `node_modules` can make installs and dev-server startup several times slower.

### macOS (Intel or Apple Silicon)

```bash
brew install git node pnpm
brew install --cask docker   # then open Docker.app once
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pnpm
# Docker Engine: https://docs.docker.com/engine/install/ubuntu/
sudo usermod -aG docker $USER   # log out and back in afterwards
```

> The **desktop installers can only be built on Windows** (see §5). The web app and API run on any OS.

---

## 2. Local development setup (any device)

```bash
# 1. Clone
git clone https://github.com/shubham075/TeamSphere.git
cd TeamSphere

# 2. Install dependencies (downloads Prisma engines and Electron; first run takes a few minutes)
pnpm install

# 3. Start PostgreSQL, Redis, S3 storage, LiveKit and Mailpit in Docker
pnpm infra:up

# 4. Create the API environment file
cp apps/api/.env.example apps/api/.env          # PowerShell: Copy-Item apps/api/.env.example apps/api/.env

# 5. Build shared types, create the database schema and seed demo users
pnpm build:shared
pnpm db:migrate
pnpm db:seed

# 6. Run API + web together
pnpm dev
```

Open **http://localhost:3000** and sign in with the seeded admin account (see §3 for all accounts). Its username and password are the
`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` values in `apps/api/.env`. Demo colleagues (`alex.morgan`,
`priya.sharma`, `daniel.kim`, `sara.lopez`) use `SEED_DEMO_PASSWORD`. These are **development-only** accounts.

### Ports used in development

| Service | Port | Notes |
|---|---|---|
| Web (Next.js) | 3000 | Proxies `/api/*` to the API |
| API (NestJS) | 4600 | `http://127.0.0.1:4600/api/health` |
| PostgreSQL | 5433 | user/pass/db: `teamsphere` |
| Redis | 6380 | |
| S3 storage (SeaweedFS) | 8333 | key `teamsphere` / `teamsphere-secret` |
| LiveKit | 7880 (HTTP/WS), 7881 (TCP), 7882 (UDP) | dev key `devkey` |
| Mailpit (test inbox) | 8025 (UI), 1025 (SMTP) | http://localhost:8025 |

Ports are shifted off the defaults (5433, 6380, 4600) to avoid clashing with other local projects. If one is
still taken, change the host port in `infra/docker-compose.yml` and the matching URL in `apps/api/.env`.

### Useful commands

| Command | What it does |
|---|---|
| `pnpm dev` | Shared types (watch) + API + web |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop Docker services (data is kept in volumes) |
| `pnpm db:migrate` | Apply / create Prisma migrations |
| `pnpm db:seed` | Re-run the dev seed (idempotent) |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Unit tests |
| `pnpm --dir apps/desktop start` | Run the desktop app against `http://localhost:3000` |

### Using a second device on the same network

To test chat or calls between two machines (for example a laptop and a desktop):

1. On the host machine, find its LAN IP (`ipconfig` / `ip addr`), e.g. `192.168.1.20`.
2. Set `WEB_ORIGIN=http://192.168.1.20:3000` in `apps/api/.env` and restart `pnpm dev`.
3. On the other device, open `http://192.168.1.20:3000`. Allow ports 3000 (and 7880–7882 for calls) through the host firewall.
4. Browsers only allow camera/microphone on **HTTPS or localhost**. For calls between devices, use the
   production setup below (with TLS), or a tunnel such as `cloudflared` / `ngrok` that gives you an HTTPS URL.

---

## 3. Accounts & credentials

TeamSphere has three ways to sign in. Use any mix of them.

### a) Development accounts (seeded)

`pnpm db:seed` creates these **development-only** accounts:

| Username | Role | Password |
|---|---|---|
| `admin` (value of `SEED_ADMIN_USERNAME`) | admin | value of `SEED_ADMIN_PASSWORD` in `apps/api/.env` |
| `alex.morgan`, `priya.sharma`, `daniel.kim`, `sara.lopez` | user | value of `SEED_DEMO_PASSWORD` in `apps/api/.env` |

The defaults come from `apps/api/.env.example`. To use your own, change those values in `apps/api/.env` **before**
running the seed. The seed never overwrites existing accounts. **Never run the seed on a production server
with the example passwords.**

### b) TeamSphere accounts (username + password)

- **First admin on a new server** (no seed): from the command line on the server:
  ```bash
  pnpm --filter @teamsphere/api user:create -- --username jane.doe --name "Jane Doe" --email jane@company.com --role admin
  ```
  You'll be asked for the password, which is never stored in shell history.
- **More people:** sign in as an admin → profile picture → **Settings → Administration → Add a TeamSphere account**,
  or use the same command with `--role user`.
- **Forgot password:** an admin can use **Settings → Administration → People → Reset password**, or on the server:
  ```bash
  pnpm --filter @teamsphere/api user:create -- --username jane.doe --reset-password
  ```
  Resetting signs the person out everywhere. Each person can change their own password in **Settings → Profile**.
- **Disable/enable** someone in **Settings → Administration → People**. Disabling signs them out at once and keeps their history.

### c) Company sign-in (SSO)

People who sign in with **Microsoft Entra ID** or the **company Active Directory** don't need a TeamSphere
password. Their account is created automatically on first sign-in, and their password is managed by the directory.
Make someone an admin by adding them to `LDAP_ADMIN_GROUP_DN` (AD) or by creating their account as admin first.

## 4. Single sign-on setup (optional)

Password login works out of the box. Enable either or both SSO methods in `apps/api/.env`:

**Microsoft Entra ID (Azure AD)**

1. Entra admin center → App registrations → New registration (single tenant).
2. Redirect URI (Web): `https://<your-server>/api/auth/entra/callback` (dev: `http://localhost:3000/api/auth/entra/callback`).
3. Create a client secret.
4. Set `ENTRA_ENABLED=true`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`.

**On-prem Active Directory (LDAP/LDAPS)**

Set `LDAP_ENABLED=true`, `LDAP_URL` (prefer `ldaps://…:636`), a read-only service account in `LDAP_BIND_DN` /
`LDAP_BIND_PASSWORD`, `LDAP_BASE_DN`, and optionally `LDAP_ADMIN_GROUP_DN` (members become TeamSphere admins).

Directory users are created automatically on first sign-in. If the same person signs in with both AD and Entra
(hybrid AD), both identities are linked to one account by email.

---

## 5. Windows desktop app

```bash
pnpm --dir apps/desktop start     # development, against http://localhost:3000
pnpm --dir apps/desktop dist      # build installers (Windows only) → apps/desktop/release/
```

Outputs `TeamSphere-Setup-<version>.exe` (per-user) and `TeamSphere-<version>-x64.msi` (per-machine, for
Intune/GPO/SCCM). Set `CSC_LINK` + `CSC_KEY_PASSWORD` to sign with your company certificate; unsigned builds
trigger a SmartScreen warning.

Server pre-configuration (`server.json`), auto-update hosting and other details are in
[apps/desktop/README.md](apps/desktop/README.md).

---

## 6. Production deployment (company server)

Recommended host: Ubuntu 22.04/24.04 (or Windows Server with Docker), 8+ vCPU, 16+ GB RAM, SSD.
Firewall: **443/TCP** (HTTPS + TURN/TLS), **7881/TCP** and **50000–60000/UDP** (WebRTC media).

1. Install Docker, clone the repo, `pnpm install`.
2. Create `apps/api/.env` from the example and change **every** secret:
   - `NODE_ENV=production`, `WEB_ORIGIN=https://teamsphere.company.local`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: generate with
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - Database, Redis, S3 and LiveKit credentials (also change them in the compose file / `infra/livekit.yaml`).
   - Remove the `SEED_*` values and create the first admin with `pnpm --filter @teamsphere/api user:create` (see §3).
3. `pnpm infra:up`, then `pnpm --filter @teamsphere/api prisma:deploy` (applies migrations without prompting).
4. Build and start: `pnpm build`, then run `node apps/api/dist/main.js` and `pnpm --dir apps/web start`
   under a process manager (systemd, PM2, or containers).
5. Put a reverse proxy with the company TLS certificate in front (Caddy or Nginx): route `/` → `127.0.0.1:3000`.
   The web app proxies `/api` to the API.
6. In `infra/livekit.yaml`: real API key/secret, remove `node_ip: 127.0.0.1` and set `use_external_ip: true`
   (or the server's LAN IP), and enable TURN/TLS on 443 for restrictive networks.
7. Nightly backups: `pg_dump` of PostgreSQL and replication of the S3 bucket.

A one-command production compose file (`infra/docker-compose.prod.yml`) is on the roadmap.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Can't reach database server at 127.0.0.1:5433` | `pnpm infra:up`; check `docker compose -f infra/docker-compose.yml ps` |
| Web shows 500 on `/api/...` | API not running or wrong port; check `http://127.0.0.1:4600/api/health` |
| `EADDRINUSE` / another app answers on a port | Another local project uses it; change the port (see §2) |
| `ERR_PNPM_IGNORED_BUILDS` | Add the package to `allowBuilds` in `pnpm-workspace.yaml` (true to allow, false to skip) |
| Very slow installs / dev startup on Windows | Antivirus scanning `node_modules`; ask IT for a Defender folder exclusion |
| Camera/mic blocked on another device | Needs HTTPS (or localhost); see §2 |
| `localhost` connection refused on Windows | Use `127.0.0.1`; Node may resolve `localhost` to IPv6 `::1` |

## License

Internal company software. All rights reserved.
