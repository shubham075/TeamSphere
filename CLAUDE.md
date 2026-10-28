# CLAUDE.md: working on TeamSphere

TeamSphere is a self-hosted Microsoft Teams–style collaboration app (internal company tool), delivered as a web app plus
a Windows desktop app. Own branding only: never use Microsoft names, logos or assets in the product.

## Start here

1. **[SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md)** is the spec: scope (§3), architecture (§6), data model (§7),
   phases (§9), decisions (§12), change log (§14). Record every scope or design change there first.
2. **[README.md](README.md)** has the roadmap table (what's done / next) and the setup steps.
3. Pick up the **first unfinished item** in the roadmap (currently: Phase 2; Phases 2, 3 and 6 were started on
   parallel branches `claude/phase2-teams-*`, `claude/phase3-calling-*`, `claude/phase6-files-*`, so check those first).
4. When you finish an item: update the README roadmap, SOURCE_OF_TRUTH §9 + §14, run checks, then commit and push.

## Product decisions (don't re-ask)

- Full Teams feature parity, **no subscription tiers**: every feature is available to everyone.
- Login: username/password **and** SSO via Microsoft Entra ID (OIDC) and on-prem AD (LDAP).
- Media: self-hosted **LiveKit**. Desktop: **Windows only**, Electron.
- **Deferred:** live captions/transcription, AI/Copilot features. **Excluded:** PSTN phone numbers, mobile apps.
- Runs on the company's own server.

## Layout & stack

```
apps/api       NestJS 11 + Prisma 6 (PostgreSQL) + Socket.IO gateway; Redis; S3 storage (SeaweedFS in dev)
apps/web       Next.js 15 (App Router, client components), Tailwind 4, TanStack Query, Zustand
apps/desktop   Electron 44 shell (loads the web app from the server), electron-builder NSIS + MSI
packages/shared  zod schemas, DTO types, WS event names. Rebuild it (pnpm build:shared) after changes
```

## Commands

```bash
pnpm infra:up                 # Docker: postgres 5433, redis 6380, seaweedfs s3 8333, livekit 7880-7882, mailpit 8025
pnpm build:shared             # required before typechecking api/web after shared changes
pnpm db:migrate               # prisma migrate dev (apps/api)
pnpm db:seed                  # dev accounts (see README §3)
pnpm dev                      # shared watch + api (4600) + web (3000)
pnpm typecheck                # all packages
pnpm --filter @teamsphere/api test          # vitest
pnpm --filter @teamsphere/api user:create -- --username x --name "X" [--role admin]
pnpm --dir apps/desktop start               # desktop dev against http://localhost:3000
pnpm --dir apps/desktop dist                # Windows installers → apps/desktop/release/
```

## Conventions

- Validate request bodies with shared zod schemas through `ZodPipe`; return the shared DTO types.
- All routes require auth (global `AccessTokenGuard`); mark exceptions with `@Public()`; admin-only with `@Roles('admin')`.
- Realtime: emit through `RealtimeService.toUsers(...)` with event names from `WS_EVENTS`; the web folds events into
  the TanStack Query cache in `components/realtime-provider.tsx` via helpers in `lib/chat.ts`.
- Files: store in S3 via `StorageService`; serve with signed URLs (`storage.sign/verify`), never public buckets.
- Audit sensitive actions with `AuditService.log`.
- Comments explain *why*; match the existing style. Keep UI accessible (labels, roles, keyboard).

## Gotchas (learned the hard way)

- Use **127.0.0.1**, not `localhost`, for server-side URLs on Windows (Node may resolve `::1`).
- API dev port is **4600** because port 4000 clashed with another local project.
- Windows PowerShell 5.1 `Set-Content -Encoding utf8` writes a **BOM**, which breaks `.env` parsing. Use bash or the editor.
- pnpm 12: packages with install scripts must be listed under `allowBuilds` in `pnpm-workspace.yaml`.
- Stop the API before `prisma generate` on Windows, because the query engine DLL is locked while it runs.
- Rebuilding `packages/shared` restarts the API watcher (it watches the shared `dist`).
- MinIO no longer publishes Docker images, so we use SeaweedFS for S3.
- Electron sandboxed preloads can only `require('electron')`; keep preload files self-contained.
- Dev machine has slow disk I/O (antivirus); first API/web start can take 1–3 minutes.

## Before you commit

`pnpm typecheck`, API tests, and an actual run of the feature (browser and/or desktop). Never commit `.env` files or
`apps/desktop/release/`. Commit messages end with the Co-Authored-By line used in history.
