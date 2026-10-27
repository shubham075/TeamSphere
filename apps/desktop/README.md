# TeamSphere for Windows

Electron shell around the TeamSphere web app (same UI, one codebase) plus native Windows features:
tray icon with status menu, Windows toast notifications (including incoming-call toasts with Accept/Decline),
screen/window picker with computer sound, taskbar unread badge, `teamsphere://` deep links, auto-start,
idle/lock detection for automatic Away, pop-out windows, Ctrl+Shift+M / Ctrl+Shift+O while in a call, auto-update.

## Develop

```bash
pnpm --dir apps/desktop start          # runs against http://localhost:3000 (start the api + web first)
```

## Build installers

```bash
pnpm --dir apps/desktop dist           # → apps/desktop/release/
```

Outputs:
- `TeamSphere-Setup-<version>.exe`: per-user NSIS installer (no admin rights needed).
- `TeamSphere-<version>-x64.msi`: per-machine MSI for Intune / Group Policy / SCCM deployment.

**Code signing:** set `CSC_LINK` (path to the .pfx) and `CSC_KEY_PASSWORD` before `dist`. Unsigned builds work,
but Windows SmartScreen will warn on first run.

## Pre-configure the server for mass deployment

Place a `server.json` in the app's `resources` folder (next to `app.asar`), e.g.
`C:\Program Files\TeamSphere\resources\server.json`:

```json
{ "serverUrl": "https://teamsphere.company.local" }
```

Users then skip the "Enter server address" screen. The `TEAMSPHERE_SERVER_URL` environment variable works too.

## Auto-update

The app checks `<server>/desktop/latest.yml` every 4 hours. On each release, copy these files from
`release/` to the server so they are served at `/desktop/`:

- `latest.yml`
- `TeamSphere-Setup-<version>.exe` (+ `.blockmap`)

With the default stack, put them in `apps/web/public/desktop/` (served by Next.js) or in the reverse proxy's static root.
Bump `version` in `apps/desktop/package.json` for every release.

## Sign-in

Microsoft Entra ID sign-in runs inside the app window. Navigation is restricted to the TeamSphere server and the
Microsoft login hosts; any other link opens in the default browser.
