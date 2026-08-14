# Build And Deployment

This guide covers production client builds and integration with the MoDiff backend. It does not turn MoDiff into a hardened public service. The supported default is a trusted, local, single-user deployment on `127.0.0.1`.

## Build Requirements

Use the locked toolchain from the repository:

- Node.js `24.12.0` from `.nvmrc`
- npm `11.6.2`
- dependencies installed with `npm ci`

Build from the client root:

```bash
npm ci
npm run check
npm run release:assets:gate
```

The checked-in `src/studio/templateAssetSource.json` must be in `huggingface` mode
with a public Dataset repository, an immutable 40-character commit SHA, and a
verified asset-set identity before producing a release. Run
`npm run release:assets:gate` to preflight the checked source, build, compare
the build's emitted source identity with that checked source, and reject any
bundled Gallery payload. `npm run test:asset-storage` remains the lightweight
unit/contract gate and deliberately permits local mode during migration and
offline development.

The build command runs TypeScript project compilation and Vite. Its output is written to `dist/` and includes:

- `index.html` and `favicon.ico`
- bundled JavaScript, styles, fonts, and brand assets under `assets/`

The source release build must not contain `dist/template-gallery`. The MoDiff
installer subsequently downloads the exact pinned Dataset, verifies every
SHA-256 digest, and performs a local-mode client build into the backend's
`web/template-gallery`. Normal installed-app reads are therefore same-origin
disk reads rather than Hub requests. See
[Template Gallery asset storage](template-gallery-assets.md).

`dist/` is generated and ignored by Git. Do not commit it to the client repository.

Release qualification fingerprints the backend's actual installer inputs:
`pyproject.toml`, `modiff/compatibility/accelerators.v1.json`, and every profile
requirements file named by that manifest. The backend intentionally declares
`[tool.uv] managed = false`; its accelerator-aware installer owns the executable
environment, so there is no repository `uv.lock` and the client release contract
must not require or synthesize one.

Before starting the long-running template qualification campaign on a clean
host, refresh its plan and verify every selected template's exact immutable
model and LoRA receipt against the running app's cache. Also verify every
byte-pinned default image, video, and audio input from the installed Template
Gallery payload:

```bash
npm run release:qualification:run -- \
  --dry-run \
  --check-app-readiness \
  --check-download-idle \
  --check-input-readiness \
  --batch-by-model-family \
  --server http://127.0.0.1:8088
```

The app readiness check is read-only, accepts only an uncredentialed loopback
origin, and fails if a required repository or revision is absent, incomplete,
not installed, or marked for repair. The download-idle check uses the app's
bounded status receipt and blocks while any model transfer or Template Gallery
installation is active or reserved. The three readiness flags opt a dry run
into their respective checks. A real campaign requires all three checks even
when the flags are omitted, repeats exact model-cache, download-idle, and input
readiness for every model-family group before submitting its first graph, and
the Gallery runner repeats download-idle immediately before every selected
template. The input readiness check reads only the selected templates' local
defaults and rejects absent files, links, size or SHA-256 mismatches, unpinned
bindings, and inconsistent asset-manifest records.
A source-release checkout without the installer-managed Gallery payload is
expected to fail the input check. On an already running source-release app,
open **Setup → Template Gallery assets** and use its app-owned plan/install
action rather than bypassing the app or substituting unverified media. The app
rechecks exact space immediately before downloading, accounts for active model
reservations, and does not delete cached models. Restart after active downloads
finish so the local static route is registered, then rerun the input check. A
successful result proves cache and source-input readiness only; it does not run
a graph, qualify output, approve rights, or publish Gallery media. Remove
`--dry-run` only on the approved qualification host when the campaign's
long-running model execution is intentional.

## Inspect The Build

For a static client-only inspection:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

This confirms that built assets load, but it is not a full MoDiff runtime test. Registry, file, queue, websocket, model, and generation behavior still require a compatible backend.

Run the bundle budget after changes that affect dependencies or code splitting:

```bash
npm run bundle:check
```

## Copy The Build Into The Backend

The MoDiff backend serves the integrated application from its `web/` directory. Replace generated client content, but preserve backend/user-owned content that is not produced by this client checkout.

PowerShell example from `MoDiff-client`. `robocopy` exit codes below 8 are
success:

```powershell
npm run build
$backend = Resolve-Path '..\MoDiff'
robocopy .\dist "$backend\web" /MIR /XD user
if ($LASTEXITCODE -ge 8) { throw "Client mirror failed with exit code $LASTEXITCODE" }
if (Test-Path "$backend\web\template-gallery") { throw 'Remote build unexpectedly contains Gallery assets.' }
```

Bash example from `MoDiff-client`:

```bash
npm run build
backend="$(cd ../MoDiff && pwd)"
rsync -a --delete --exclude '/user/' dist/ "$backend/web/"
test ! -e "$backend/web/template-gallery"
```

Before running either example, verify that the resolved backend path is the intended checkout. Do not delete the entire backend `web/` directory: a deployment may contain backend-owned or user-provided content such as `web/user/` custom fields.

These manual commands create the lightweight source-release build. The normal
backend `install.sh` / `install.ps1` flow instead verifies or downloads the
complete Gallery before building, bundles it into `web/template-gallery`, and
fails installation if that exact snapshot cannot be prepared.

## Run The Integrated Build

Start the managed backend from its repository:

```bash
./run.sh
```

On Windows use `.\run.ps1`.

Then open `http://127.0.0.1:8088/`. The backend should serve the client and API/websocket routes from one origin.

Verify at least:

```bash
curl -fsS http://127.0.0.1:8088/ > /dev/null
curl -fsS http://127.0.0.1:8088/health > /dev/null
curl -fsS http://127.0.0.1:8088/nodes > /dev/null
curl -fsS http://127.0.0.1:8088/runtime/status > /dev/null
```

Also load the UI in a browser, confirm the websocket connects, create a
lightweight graph, and open Gallery. In browser network tools, verify its
manifest, an image, audio, video, and a default input resolve from the expected
public Dataset commit without authentication; no request may use `main`.

## Separate-Origin Hosting

Development normally uses the Vite proxy. A production build normally uses backend same-origin hosting. If you intentionally host the client and backend on different origins:

1. Build with `VITE_SERVER_ADDRESS` set to the complete backend origin.
2. Configure backend HTTP CORS for only the intended client origin.
3. Configure websocket origin checks and the correct `ws://` or `wss://` path.
4. Terminate TLS before sending prompts, media, or workflow metadata over a network.
5. Add authentication and authorization outside the current application.
6. Restrict filesystem endpoints, upload size, request rate, and model/custom-module administration.

MoDiff does not currently provide the authentication boundary required for an internet-facing multi-user service. Binding the backend to `0.0.0.0` without compensating controls can expose local files, uploaded media, generated outputs, model operations, and graph execution.

## Release Checklist

Before publishing a client/backend pair:

1. Run `npm ci`, `npm run check`, and `npm run check:ui` in the client.
2. Run `npm run test:asset-storage`, `npm run gallery:verify`, and
   `npm run gallery:coverage` if Gallery metadata or content changed, then run
   `npm run release:assets:gate` for every release build.
3. Build and copy the client into the exact backend revision being released.
4. Run the backend test and preflight commands documented by that backend revision.
5. Start the integrated backend from a clean process and verify the endpoints above.
6. Confirm the built bundle contains no personal paths, credentials, private repository URLs, or stale product names.
7. Confirm the pinned public Dataset manifest is anonymously readable, every
   referenced file matches its SHA-256, and published provenance is redacted.
8. Confirm user/custom files in `web/` were not deleted by the sync.
9. Document which model paths were mocked, schema-validated, or live-run; do not collapse those proof levels into one support claim.
10. Keep the server on localhost unless the deployment has the controls listed under separate-origin hosting.
