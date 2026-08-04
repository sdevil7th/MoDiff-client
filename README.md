<!-- Derived from cubiq/Mellon-client@af0c5801f843453a1700733596e99fe6589b2e86; modified by MoDiff. -->

# MoDiff Client

MoDiff Client is the graph-first web interface for the MoDiff generative-media backend. It combines a visual node editor with a guided Studio for image, video, and audio workflows. Users can start from a task or curated recipe, inspect the graph that will run, install required Hugging Face artifacts, follow queue progress, and restore generated outputs as editable workflows.

The client is built with React 19, TypeScript, Vite, Tailwind CSS, Headless UI, Zustand, Lucide React, and [`@xyflow/react`](https://reactflow.dev/).

> [!IMPORTANT]
> MoDiff is under active development. It is designed for a trusted, local, single-user environment and has not been hardened as an internet-facing multi-user service. Model support depends on the backend version, installed packages, model access terms, hardware, and available disk space. The UI keeps unsupported or unproven paths visibly blocked instead of treating every listed model as runnable.

## Install and run MoDiff

Clone both repositories into the same parent directory. The backend installer
automatically finds this sibling client, installs its locked Node.js toolchain
and packages, downloads the verified Gallery assets, and bundles the frontend.
The backend [installation guide](https://github.com/sdevil7th/MoDiff#install-and-run)
is the canonical source for installer profiles, prerequisites, repair, and
platform support.

Linux or macOS:

```bash
git clone https://github.com/sdevil7th/MoDiff.git MoDiff
git clone https://github.com/sdevil7th/MoDiff-client.git MoDiff-client
cd MoDiff
./install.sh --accelerator auto
./run.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/sdevil7th/MoDiff.git MoDiff
git clone https://github.com/sdevil7th/MoDiff-client.git MoDiff-client
cd MoDiff
.\install.ps1 -Accelerator auto
.\run.ps1
```

Open <http://127.0.0.1:8088>. No separate frontend install or frontend process
is needed for normal use.

### Which launcher should I use?

| Purpose                              | Start                                 | Stop             | What runs                                                                |
| ------------------------------------ | ------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| Use the installed app on Linux/macOS | From `MoDiff`: `./run.sh`             | Press `Ctrl+C`   | The backend and its installed frontend bundle at `http://127.0.0.1:8088` |
| Use the installed app on Windows     | From `MoDiff`: `.\run.ps1`            | Press `Ctrl+C`   | The backend and its installed frontend bundle at `http://127.0.0.1:8088` |
| Develop the frontend on Linux/macOS  | From `MoDiff-client`: `./run-dev.sh`  | `./stop-dev.sh`  | The backend plus a separate Vite frontend with hot reload                |
| Develop the frontend on Windows      | From `MoDiff-client`: `.\run-dev.ps1` | `.\stop-dev.ps1` | The backend plus a separate Vite frontend with hot reload                |

Use `run.sh` or `run.ps1` unless you are editing frontend source code.

## What You Can Do

- Build and inspect backend-native graphs on a visual canvas.
- Start guided text-to-image, editing, inpainting, outpainting, control, layered-image, video, and advanced workflows.
- Browse curated templates and proof-backed Gallery examples.
- Use **Auto** to select a known hardware-aware recipe, or **Expert** to expose lower-level graph and runtime controls.
- Discover local and Hugging Face model artifacts and start supported downloads from the UI.
- Follow queue state, step progress, failures, and accelerator cleanup actions.
- Keep multiple local workflow tabs and restore a generated output with its form and graph context.
- Export a workflow package, an output package, or raw graph JSON where available.
- Add backend-defined nodes and custom React fields without creating a separate execution system.

## Repository Pairing

MoDiff is split into two repositories:

```text
parent-directory/
|-- MoDiff/          # Python backend, node registry, model runtime, static web host
`-- MoDiff-client/   # This React/Vite client
```

The development launchers detect this sibling layout automatically. The client can run by itself for mocked UI tests, but real registry, model, queue, file, and generation behavior requires the MoDiff backend.

## Requirements

Client development requires:

- Git
- Node.js `24.12.0` (the version in [`.nvmrc`](.nvmrc))
- npm `11.6.2`
- A Chromium-based browser for the default Playwright suite

Integrated development also requires:

- A sibling MoDiff backend checkout, or its path passed to the launcher
- The backend's managed Python 3.12 environment, installed with its reviewed
  `install.ps1` or `install.sh` profile
- Sufficient RAM, accelerator memory, and disk space for the model being used
- Hugging Face authorization for gated model repositories, when applicable

Node and npm versions are intentionally constrained in [`package.json`](package.json). Check them before installing:

```bash
node --version
npm --version
```

For backend and accelerator prerequisites, follow the backend README first. Platform-specific client notes are available for [Windows](docs/windows-support.md), [Ubuntu Linux](docs/linux-support.md), and [Apple Silicon macOS](docs/macos-support.md).

## Development quick start

Clone the backend and client into the sibling layout shown above:

```bash
git clone https://github.com/sdevil7th/MoDiff.git MoDiff
git clone https://github.com/sdevil7th/MoDiff-client.git MoDiff-client
```

For an editable two-process development session, run the client repository's
development installer. It installs the backend in backend-only mode, adds the
backend test requirements, installs the locked client dependencies, and writes
a preflight report without building the production frontend bundle.

Windows PowerShell, from `MoDiff-client`:

```powershell
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
```

Linux or macOS, from `MoDiff-client`:

```bash
chmod +x install-dev.sh run-dev.sh stop-dev.sh
./install-dev.sh --accelerator auto
```

For a non-sibling POSIX checkout, set `MODIFF_BACKEND_DIR` for both commands:

```bash
MODIFF_BACKEND_DIR=/path/to/MoDiff ./install-dev.sh --accelerator auto
MODIFF_BACKEND_DIR=/path/to/MoDiff ./run-dev.sh
```

Start both applications on Windows:

```powershell
.\run-dev.ps1
```

Start both applications on Ubuntu Linux or Apple Silicon macOS:

```bash
chmod +x run-dev.sh stop-dev.sh
./run-dev.sh
```

The launcher:

1. Finds the backend through `MODIFF_BACKEND_DIR`, `../MoDiff`, or `../modiff`.
2. Runs the backend preflight before starting a new backend process.
3. Starts or reuses the backend at `http://127.0.0.1:8088`.
4. Starts Vite on the first free port at or after `5173`.
5. Proxies HTTP and websocket traffic from Vite to the backend.
6. Opens the client URL unless browser launch is disabled.

The latest launcher preflight report is written to `artifacts/dev-server-current/backend-preflight.json`.

Use a non-sibling backend path or different ports when needed:

```powershell
.\run-dev.ps1 -BackendPath "C:\path\to\MoDiff" -BackendPort 8088 -FrontendPort 5173 -NoBrowser
```

```bash
./run-dev.sh --backend-path /path/to/MoDiff --backend-port 8088 --frontend-port 5173 --no-browser
```

Stop only recognized MoDiff development processes and request accelerator cleanup first:

```powershell
.\stop-dev.ps1
```

```bash
./stop-dev.sh
```

The stop scripts deliberately leave unrelated listeners alone. Their `StopAnyListener`/`--stop-any-listener` options are escape hatches and should be used only after verifying the target process.

## Your First Workflow

1. Wait for the top-bar connection indicator, then open **Setup**. Confirm the
   runtime profile is usable and resolve any environment or model-cache repair
   blocker before starting a model download.
2. On the empty canvas, choose **Text to image** or click **Browse recipes**.
   Prefer a lightweight image recipe that Auto marks ready for the detected
   device; a large video or audio model is not a useful first smoke test.
3. Open the right-side **Studio** panel and keep the resource-mode **Auto**
   switch enabled for the first run.
4. Enter a prompt or select a template. Studio creates or reconciles the visible
   graph; the canvas remains the workflow that will execute.
   Templates whose reviewed dependencies require a usage notice show one
   warning icon. Their first **Review terms** action lists only those restricted
   model dependencies and links to the original terms. Acknowledging the notice
   creates the local graph; it does not change or grant any model rights.
5. Review readiness. If an artifact is missing or incomplete, use its
   **Install** or **Repair** action. For a gated repository, accept its upstream
   terms and configure a least-privilege Hugging Face read token.
6. Wait for **Setup** or **Models** to report the artifact as runnable, then use
   one-shot **Run**. Blocking inputs, model requirements, or graph errors are
   shown before submission.
7. Follow the active phase, node, step counter, elapsed time, and ETA when
   available in the session shelf or **Queue**. Model preparation may take much
   longer on the first run than on later cached runs.
8. Use **Stop** only when you intend to interrupt the work. Some native model
   calls cannot acknowledge cancellation until they return control.
9. Open **Gallery** after completion. Inspect metadata, download media, restore
   or rerun the workflow, favorite the output, or send it into an edit flow.
10. Use the top-bar **Export** menu to save a portable workflow or output
    package before clearing browser data.

See the [Studio user guide](docs/studio-user-flow.md) for tasks, interface areas, workflow tabs, Gallery behavior, setup, failure recovery, and a manual verification checklist.

## Auto And Expert

**Auto** asks the backend planner for a known local recipe. The planner evaluates the selected model and task, installed artifacts, backend package versions, accelerator resources, system memory, and offload headroom. Auto enables Run only when the selected candidate reports sufficient compatibility evidence.

The backend planner is the compatibility authority. Template cards, Setup,
Models, and Run readiness render the same structured assessment and do not
apply their own GPU-memory thresholds. While that assessment is pending they
show **Checking compatibility** instead of guessing from a device label or a
dedicated-VRAM number. This is important for Apple unified memory, AMD shared
memory, and Intel integrated/XPU devices.

This resource-mode Auto switch is separate from the **Auto** item inside the
Run menu. Resource Auto selects a hardware-aware recipe. Run-menu Auto repeats
execution after graph parameter changes; keep it off when you want a single
generation.

**Expert** exposes artifact, dtype, quantization, offload, device, and lower-level graph controls. Expert is useful for development and explicitly experimental paths; it is not a promise that an arbitrary combination will fit the machine or execute successfully.

Important model-support rules:

- A model shown in the catalog is discoverable, not necessarily runnable.
- A cached directory is not considered complete merely because it exists.
- Gated Hugging Face models require the user to accept the model terms and authenticate outside MoDiff as required by Hugging Face.
- A model-access error opens recovery for the exact repository: review its
  Hugging Face access page, configure a read token, and retry. MoDiff cannot
  accept Hugging Face terms on the user's behalf.
- Some Qwen and FLUX variants remain Expert-only until their execution contract and resource recipe are validated.
- Video and audio jobs may be much slower and more storage-intensive than image jobs.
- CPU, Apple MPS, or Intel XPU availability does not imply that every model family has been validated on that device.

Runnable does not mean fast. Auto chooses an eligible recipe and exposes its
qualification state; it is not a performance guarantee. An integrated/shared-memory GPU can report a large
addressable pool while performing far below a discrete GPU with the same local
VRAM figure. Downloading, validation, pipeline loading, and weight placement
can also dominate the first execution before denoising begins.

Without changing the prompt, resolution, steps, or other generation inputs, a
later run can sometimes improve through a qualified pre-quantized artifact,
supported attention backend, compile/cache path, or better device placement.
These runtime-recipe changes require the pipeline to reload and cannot safely
speed up a run already in progress. Expert visibility is not evidence that a
quantizer or optional kernel is supported on the active platform.

On Apple Silicon, Studio selects `mps:0`; on supported Intel Arc or integrated
graphics with the preview runtime it selects `xpu:0`. Both use direct device
residency and intentionally disable CUDA-only CPU-offload hooks. Integrated
Intel graphics and Apple unified memory share system capacity, so Auto uses the
reported planning budget and keeps exact model/recipe combinations visibly
unqualified until a retained real-run receipt proves them.

The durable planner contract and model-onboarding checklist are documented in [Auto mode design](docs/auto-mode-design.md).

## Interface Map

| Area       | Purpose                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| Top bar    | Connection state, New, Auto/Expert, Run mode, Run/Stop, Export, model manager, and settings |
| Left rail  | Nodes, templates, generated/imported Gallery media, models, and backend workflow files      |
| Canvas     | Visual graph editing, connections, node actions, and workflow tabs                          |
| Studio     | Guided task, model, prompt, input, generation, and graph controls                           |
| Queue      | Current and recent task state, progress, cancellation, and failures                         |
| Setup      | Backend runtime, capability metadata, model/cache diagnostics, and installation status      |
| Run as app | Expert-only simplified controls for graphs with a usable output surface                     |

Workflow tabs are stored locally in the browser. Each tab preserves its visual graph, viewport, Studio form, graph binding, and template/Gallery provenance where available.

## Frontend-Only Development

If the backend already runs elsewhere, start only Vite with the development proxy:

```powershell
$env:VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:8088'
npm run dev -- --host 127.0.0.1 --port 5173
```

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088 npm run dev -- --host 127.0.0.1 --port 5173
```

The proxy is the recommended development setup because browser requests stay on the Vite origin. To make the client call a server origin directly, create an ignored `.env.development` file:

```dotenv
VITE_SERVER_ADDRESS=http://127.0.0.1:8088
```

`VITE_SERVER_ADDRESS` must be the backend origin, including `http://` or `https://`. A direct cross-origin deployment also needs compatible backend CORS and websocket configuration.

For workstation-specific Vite overrides, create the ignored `vite.config.local.ts`. Keep those changes local; do not place machine addresses or credentials in committed configuration.

## Updating

For the installed application, stop the foreground backend, update both sibling
repositories, and rerun the backend installer so it validates the managed
runtime and rebuilds the bundled client. Use the complete cross-platform
procedure in the backend [updating guide](https://github.com/sdevil7th/MoDiff#updating-and-recovery).

For an editable development checkout, pull both repositories and rerun the
development installer before launching again:

```bash
git -C ../MoDiff pull --ff-only
git pull --ff-only
./install-dev.sh --accelerator auto
./run-dev.sh
```

```powershell
git -C ..\MoDiff pull --ff-only
git pull --ff-only
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
.\run-dev.ps1
```

Do not update or repair either environment while a model run is active.

## Build And Serve

Create a production client build:

```bash
npm run build
```

Vite writes the static output to `dist/`. `npm run preview` can inspect that build locally, but an integrated MoDiff installation should serve the files from the backend so API and websocket requests share the same origin.

Remote-mode builds contain no Gallery media. When copying a new build into the
backend, replace generated shell files under `web/` while preserving
backend-owned files such as `web/user` custom fields. The full procedure is in
[Build and deployment](docs/deployment.md), and the public Dataset lifecycle is
in [Template Gallery asset storage](docs/template-gallery-assets.md).

## Validation

Run the same complete static/unit/build gate used by CI:

```bash
npm run check
```

Run the mocked Studio browser suite:

```bash
npx playwright install chromium
npm run check:ui
```

Useful narrower commands include:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run style:audit
npm run test:unit
npm run build
npm run bundle:check
npm run gallery:verify
npm run gallery:coverage
```

The mocked browser suite does not download models or require a live backend. Real model validation is intentionally separate because it depends on hardware, model access, and large local artifacts.

## Data, Privacy, And Security

MoDiff is local-first, but it is not data-free:

- The browser persists graph, settings, workflow-tab, Studio, and recent-output metadata in local storage.
- Imported files and generated outputs can be persisted by the backend under its configured data directories.
- Model installation contacts Hugging Face and writes to the configured model cache.
- Exported workflow/output packages can contain prompts, parameters, model repository names, graph structure, input/output references, and provenance metadata.
- The client and backend do not provide authentication suitable for direct public exposure.

Keep both servers bound to `127.0.0.1` unless you have deliberately added authentication, TLS, request limits, origin controls, and filesystem isolation. Inspect exports before publishing them. See [Privacy and security](docs/privacy-and-security.md) and [SECURITY.md](SECURITY.md) for data locations, cleanup guidance, deployment boundaries, and vulnerability reporting.

To remove local history or files, export anything important first and follow
[Clearing Local Data](docs/privacy-and-security.md#clearing-local-data). Stop
MoDiff before deleting backend data, and inspect individual paths rather than
removing `data/`, `config.ini`, or a shared Hugging Face cache wholesale.

## Troubleshooting

Start with the preflight report and browser connection state. Common fixes include:

- Verify Node/npm against `package.json`, then rerun `npm ci`.
- Verify the backend path and run `python -m modiff.preflight --json --check-port 8088 --fail-on-error` from the backend environment.
- If port `8088` is occupied, identify the listener before reusing or stopping it; the Windows launcher treats an occupied backend port as an existing server.
- Confirm the client origin can request `/health`, `/nodes`, and `/runtime/status` through the Vite proxy.
- For a missing or partial model, use **Setup** or **Models** and follow the reported repair/access action instead of moving cache files manually.
- For an out-of-memory failure, stop the run, use accelerator cleanup, reduce the workflow, or return to a known Auto recipe.
- If a run is slow, check whether its active phase or step counter is advancing
  before treating it as stalled. The troubleshooting guide explains download,
  placement, denoising, decode/export, and shared-memory performance.

The [troubleshooting guide](docs/troubleshooting.md) contains platform-specific commands and recovery steps.

## Documentation

Start with the [documentation index](docs/README.md):

- [Studio user guide](docs/studio-user-flow.md)
- [Auto mode design](docs/auto-mode-design.md)
- [Build and deployment](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Privacy and security](docs/privacy-and-security.md)
- [Client architecture](docs/modiff-client-architecture.md)
- [Frontend style guide](docs/frontend-style-guide.md)
- [Windows support](docs/windows-support.md)
- [Ubuntu Linux support](docs/linux-support.md)
- [Apple Silicon macOS support](docs/macos-support.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code, UI behavior, dependencies, or documentation. AI-assisted changes must also follow [AGENTS.md](AGENTS.md) and [the Copilot instructions](.github/copilot-instructions.md).

Please use the repository's issue tracker for reproducible bugs and feature proposals. Do not post credentials, private prompts/media, access tokens, local filesystem listings, or unredacted diagnostics in public issues.

## License

MoDiff Client source code is available under the [Apache License 2.0](LICENSE) and retains the copyright notice from
[Mellon Client](https://github.com/cubiq/Mellon-client), from which this client
was derived. Model weights, adapters, and Gallery media are not relicensed by MoDiff and remain subject to their
respective upstream terms. Datasets, generated-media inputs, and third-party dependencies may also have separate
licenses or acceptable-use terms; users are responsible for reviewing them. Notices for
font software redistributed with the client are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The production web
distribution also ships a generated, lock-derived
[dependency license inventory](public/THIRD_PARTY_LICENSES.txt); regenerate it
with `npm run licenses:generate` after dependency changes.
