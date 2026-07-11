# Troubleshooting

Use this guide for local development and integrated client/backend failures. Start with concrete process, port, endpoint, and preflight evidence; a browser tab being open does not prove that either server is healthy.

## Collect A Minimal Diagnostic Snapshot

Record the following without including tokens, prompts, private media, or full local paths in a public issue:

- Operating system and architecture
- Node and npm versions
- Python version and backend revision
- Client revision
- Frontend and backend ports
- The failing command and its exit code
- The smallest relevant browser-console or backend-log excerpt
- Whether the issue reproduces with the mocked UI suite or only with a real model

Run:

```bash
node --version
npm --version
git rev-parse --short HEAD
npm run typecheck
```

From the backend environment:

```bash
python -m modiff.preflight --json --check-port 8088 --fail-on-error
```

The launcher also saves its latest report at `artifacts/dev-server-current/backend-preflight.json`. Redact usernames, cache paths, device identifiers, and environment details before sharing it.

## Client Install Problems

The supported client toolchain is defined in `.nvmrc`, `package.json`, and `package-lock.json`.

1. Confirm Node `24.12.x` and npm `11.6.x`.
2. Use `npm ci`; do not regenerate the lockfile just to work around an install failure.
3. If the lockfile and manifest intentionally changed together, run `npm install` once as part of that dependency change, review the diff, and return to `npm ci` for validation.
4. If native browser installation fails, retry `npx playwright install chromium` and follow Playwright's platform dependency message.

## Backend Path Not Found

The combined launcher looks for the backend in this order:

1. `MODIFF_BACKEND_DIR`
2. sibling `../MoDiff`
3. sibling `../modiff`

Pass the path explicitly when the repositories are elsewhere:

```powershell
.\run-dev.ps1 -BackendPath "C:\path\to\MoDiff"
```

```bash
./run-dev.sh --backend-path /path/to/MoDiff
```

The selected directory must contain the compatible backend checkout and environment, not only a copied `web/` build.

## Port Already In Use

The default backend port is `8088`. Vite starts at `5173` and chooses a later free frontend port. On Windows the launcher treats any listener on the requested backend port as an existing backend, so identify it before relying on it.

PowerShell:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8088,5173 | Select-Object LocalPort,OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" | Select-Object ProcessId,Name,CommandLine
```

Linux/macOS:

```bash
lsof -nP -iTCP:8088 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Use `stop-dev.ps1` or `stop-dev.sh` for repository-owned processes. They verify command lines before stopping listeners unless the explicit force option is supplied.

## Frontend Opens But Backend Is Disconnected

Check the backend directly:

```bash
curl -fsS http://127.0.0.1:8088/health
curl -fsS http://127.0.0.1:8088/nodes
curl -fsS http://127.0.0.1:8088/runtime/status
```

Then check the same routes through Vite, using the actual port printed by the launcher:

```bash
curl -fsS http://127.0.0.1:5173/health
curl -fsS http://127.0.0.1:5173/nodes
```

If direct requests work but proxied requests do not:

- Verify `VITE_BACKEND_PROXY_TARGET` was set in the Vite process.
- Remove an old `VITE_SERVER_ADDRESS` from the shell when using the proxy.
- Restart Vite after environment changes.
- Check browser-console websocket errors and mixed-content errors.

If using direct server mode, `VITE_SERVER_ADDRESS` must include the protocol and must point to the backend, not the Vite port.

## Registry Or Studio Nodes Are Missing

Studio builds from the live `/nodes` registry. A client profile does not create backend support by itself.

1. Restart the backend after installing or changing modules.
2. Confirm `/nodes` contains the module/action named by the readiness issue.
3. Open **Setup** and refresh runtime/capability metadata.
4. Ensure the client and backend revisions are intended to work together.
5. Treat a blocked recipe as a capability mismatch; do not bypass the gate by editing browser storage.

## Model Shows Missing, Repair, Or Access Required

Use **Setup** or **Models** to view the authoritative state:

- **Missing** means the selected runnable artifact is not available in the configured model indexes.
- **Repair** or incomplete state means a cache directory exists but required files are absent or still materializing.
- **Access required** means the upstream repository is gated/private or the current Hugging Face credentials cannot read it.
- A discovered external model folder may remain non-runnable if no backend loader imports that layout.

For gated repositories, accept the model terms on Hugging Face and configure credentials through supported Hugging Face tooling. Never paste a token into an issue, screenshot, workflow export, or tracked `.env` file.

Avoid moving individual Hugging Face blob/snapshot files by hand. Cache structure and immutable revisions are part of artifact validation.

## Download Progress Appears Stuck

Large model downloads can spend time resolving metadata or materializing files without a stable total. Check:

- The active download entry in **Models** or **Setup**
- Available disk space in the configured Hugging Face cache
- Backend log activity
- The reported cache file/byte counts
- Network and Hugging Face access outside the app

Do not start duplicate downloads for the same repository. The client joins matching active installs, and the backend limits concurrent work.

## Run Is Blocked

Read the blocking issues dialog from top to bottom. Common blockers are:

- Backend websocket disconnected
- Empty or invalid graph
- Missing required input image, mask, video, or audio
- Missing/incomplete model artifact
- Auto planner has no proven recipe for the machine
- Backend package or node capability missing
- Graph finalization still applying dynamic field changes

Use Auto for the first known recipe. Switch to Expert only when you intend to diagnose or author an experimental graph.

## Out Of Memory Or Accelerator Failure

1. Stop the active run.
2. Use **Release accelerator cache** when the failure dialog offers it, or call `POST /runtime/gpu_cleanup` on a trusted local backend.
3. Close other accelerator-heavy applications.
4. Retry with a known Auto recipe, smaller spatial/temporal inputs, fewer frames, or a lighter model.
5. Restart the backend if the runtime remains unhealthy.

An Auto recipe can reduce risk but cannot guarantee success under changing memory pressure. Include the selected model, task, dimensions/frames, and the redacted exception type in a bug report.

## Queue Or UI State Looks Stale

- Refresh **Queue** and **Setup** after confirming the backend is healthy.
- Reconnect the websocket by restarting the client if the connection indicator does not recover.
- Keep separate workflow tabs in mind: attributed run updates do not intentionally overwrite a different active tab.
- Do not clear browser storage until after exporting any workflow you need to keep.

To isolate browser persistence, use a temporary browser profile or clear only this origin's site data. The relevant local-storage keys are `modiff.flow`, `modiff.settings`, and `modiff.studio`. Clearing them does not remove backend-persisted uploads, outputs, models, or workflow files.

## Browser Or HMR Problems

When a development websocket repeatedly disconnects:

- Confirm the Vite port printed by the launcher.
- Disable extensions that intercept local requests.
- Try a clean browser profile.
- Retry in Firefox to separate a Chromium-specific development issue.
- Restart Vite after changing proxy or host configuration.

The mocked Playwright suite uses its own frontend port (`5191` by default) and mocked routes. A passing mocked suite proves UI behavior, not live backend/model health.

## Tests Fail

Run the narrow failing command first, then the full gate:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run bundle:check
npm run check
```

For Playwright failures, inspect `playwright-report/` and `test-results/`. These directories are generated and ignored by Git. Redact screenshots or traces before sharing when they contain local paths, prompts, or media.

## Asking For Help

Use the public issue tracker for reproducible, non-sensitive problems. Use the process in [SECURITY.md](../SECURITY.md) for vulnerabilities. Include what you expected, what happened, exact reproduction steps, and the smallest sanitized evidence needed to distinguish client, backend, model, and environment failures.
