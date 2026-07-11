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
npm run build
```

The build command runs TypeScript project compilation and Vite. Its output is written to `dist/` and includes:

- `index.html` and `favicon.ico`
- bundled JavaScript, styles, fonts, and brand assets under `assets/`
- the checked-in template Gallery manifest, media, inputs, and review records under `template-gallery/`

`dist/` is generated and ignored by Git. Do not commit it to the client repository.

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

PowerShell example from `MoDiff-client`:

```powershell
npm run build
$backend = Resolve-Path '..\MoDiff'

Remove-Item -LiteralPath "$backend\web\assets" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$backend\web\template-gallery" -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item -LiteralPath '.\dist\index.html' -Destination "$backend\web\index.html" -Force
Copy-Item -LiteralPath '.\dist\favicon.ico' -Destination "$backend\web\favicon.ico" -Force
Copy-Item -LiteralPath '.\dist\assets' -Destination "$backend\web\assets" -Recurse -Force
Copy-Item -LiteralPath '.\dist\template-gallery' -Destination "$backend\web\template-gallery" -Recurse -Force
```

Bash example from `MoDiff-client`:

```bash
npm run build
backend="$(cd ../MoDiff && pwd)"

rm -rf "$backend/web/assets" "$backend/web/template-gallery"
cp dist/index.html "$backend/web/index.html"
cp dist/favicon.ico "$backend/web/favicon.ico"
cp -R dist/assets "$backend/web/assets"
cp -R dist/template-gallery "$backend/web/template-gallery"
```

Before running either example, verify that the resolved backend path is the intended checkout. Do not delete the entire backend `web/` directory: a deployment may contain backend-owned or user-provided content such as `web/user/` custom fields.

## Run The Integrated Build

Start the backend from its repository:

```bash
uv run main.py
```

Then open `http://127.0.0.1:8088/`. The backend should serve the client and API/websocket routes from one origin.

Verify at least:

```bash
curl -fsS http://127.0.0.1:8088/ > /dev/null
curl -fsS http://127.0.0.1:8088/health > /dev/null
curl -fsS http://127.0.0.1:8088/nodes > /dev/null
curl -fsS http://127.0.0.1:8088/runtime/status > /dev/null
curl -fsS http://127.0.0.1:8088/template-gallery/manifest.json > /dev/null
```

Also load the UI in a browser, confirm the websocket connects, create a lightweight graph, open Gallery, and verify that an image and a video preview use the expected content types.

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
2. Run `npm run gallery:verify` and `npm run gallery:coverage` if Gallery content changed.
3. Build and copy the client into the exact backend revision being released.
4. Run the backend test and preflight commands documented by that backend revision.
5. Start the integrated backend from a clean process and verify the endpoints above.
6. Confirm the built bundle contains no personal paths, credentials, private repository URLs, or stale product names.
7. Confirm the Gallery manifest references files that exist and that provenance intended for publication is redacted.
8. Confirm user/custom files in `web/` were not deleted by the sync.
9. Document which model paths were mocked, schema-validated, or live-run; do not collapse those proof levels into one support claim.
10. Keep the server on localhost unless the deployment has the controls listed under separate-origin hosting.
