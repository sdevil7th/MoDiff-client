# Windows Support

Run the MoDiff backend and Vite client on the same Windows workstation. Developers
can use the uv/npm commands below; combined PowerShell launchers are also available.

## Prerequisites

- 64-bit Windows 10/11
- Git
- uv `0.11.26` for the developer commands below; it can provision Python 3.12
- PowerShell 5.1 or PowerShell 7+
- Node.js `24.12.0` and npm `11.6.2`
- A current NVIDIA driver for CUDA workflows
- Sufficient disk space for model caches, outputs, and optional offload files

The CUDA toolkit/compiler is not required for normal prebuilt PyTorch wheels, but optional packages that build native CUDA extensions may require Visual Studio Build Tools and a compatible CUDA toolchain.

## Repository Layout

Keep both checkouts next to each other for automatic detection:

```text
C:\path\to\projects\
|-- MoDiff\
`-- MoDiff-client\
```

## Developer Setup With uv And npm

From a clean backend checkout, install the CPU development profile:

```powershell
uv run --no-project --no-sync --python 3.12 -m modiff.dev plan --accelerator cpu --backend-only --json
uv run --no-project --no-sync --python 3.12 -m modiff.dev setup --accelerator cpu --backend-only --non-interactive
uv run --no-project --no-sync --python 3.12 -m modiff.dev check --json --check-port 8088 --fail-on-error
uv run --no-project --no-sync --python 3.12 -m modiff.dev run
```

In a second terminal, from `MoDiff-client`:

```powershell
npm ci
npm run dev
```

Open the URL printed by Vite. Stop each process with `Ctrl+C` in its terminal.
These commands do not require running a repository PowerShell script or changing
PowerShell execution policy. The backend-only install serves the checked client
bundle too, at <http://127.0.0.1:8088>.

Setup installs Python packages, including Torch, without downloading inference
weights. An existing managed `.venv` is preserved; use `check` to inspect it and
`run` to launch it. Test a clean CPU install in a separate checkout from a working
GPU environment. A deliberate profile replacement requires `setup --repair`.
Choose `--accelerator nvidia`, `intel`, or `auto` in both `plan` and `setup` for
the applicable accelerator profile. Optional runtimes retain their explicit
installation and consent flow.

The backend's [developer setup guide](https://github.com/sdevil7th/MoDiff/blob/feat/generic-diffusers-workbench/docs/developer-setup.md)
explains the managed dependency contract and uv flags. Ordinary `uv sync` and
project-resolving `uv run` are not supported in the accelerator environment.
For named API inputs/outputs and the model-free service example, see the
[service prototyping guide](https://github.com/sdevil7th/MoDiff/blob/feat/generic-diffusers-workbench/docs/service-prototyping.md).

## Backend Setup

For guided setup, run the PowerShell installer from the backend checkout:

```powershell
.\install.ps1 -Accelerator auto
.\.venv\Scripts\python.exe -m modiff.preflight --json --check-port 8088 --fail-on-error
```

Use `-Accelerator nvidia`, `-Accelerator intel`, or `-Accelerator cpu` to make
the choice explicit. The Intel choice installs the preview PyTorch XPU profile
for supported Arc and integrated graphics and must pass a real `xpu:0` tensor;
integrated devices share system memory and use direct residency without
CUDA-only CPU-offload hooks. The AMD Windows profile represents AMD's official
selected-hardware path but remains blocked until MoDiff pins and validates the
complete SDK wheel set; do not let pip resolve the CUDA profile on an AMD
machine. Inspect the plan without changing the machine with:

```powershell
.\install.ps1 -Accelerator auto -DryRun -SystemCheck -Json
```

The backend defaults to `127.0.0.1:8088` and local data paths. To customize them:

```powershell
Copy-Item config.example.ini config.ini
```

`config.ini` is ignored and can contain machine-local paths or a Hugging Face read token. Keep it private. Prefer a least-privilege token and do not paste it into prompts, logs, screenshots, or issues.

## Client Setup And Launch

For combined setup and launch through PowerShell scripts, run from `MoDiff-client`:

```powershell
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
.\run-dev.ps1
```

The launcher:

- detects the sibling backend or accepts `-BackendPath`
- uses and validates the backend's managed `.venv\Scripts\python.exe`
- runs the backend preflight before starting a new backend
- starts the backend in a dedicated PowerShell window
- starts Vite in a second window with the backend proxy configured
- uses the first free frontend port starting at `5173`
- opens the browser unless `-NoBrowser` is supplied

Examples:

```powershell
.\run-dev.ps1 -BackendPath "C:\path\to\MoDiff" -NoBrowser
.\run-dev.ps1 -BackendPort 8089 -FrontendPort 5200 -BackendWaitSeconds 60
```

If script execution is blocked by local policy, use a process-scoped bypass instead of changing machine-wide policy:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-dev.ps1
```

## Stop Development Processes

For the uv/npm terminals above, use `Ctrl+C` in each terminal. For processes
started by the combined development launcher:

```powershell
.\stop-dev.ps1
```

The script finds listeners on the configured backend/frontend port range, verifies that their command lines look like MoDiff processes, calls `/runtime/gpu_cleanup` when stopping the backend, and then stops only matching processes.

Useful options:

```powershell
.\stop-dev.ps1 -SkipGpuCleanup
.\stop-dev.ps1 -BackendPort 8089 -FrontendPort 5200
```

`-StopAnyListener` disables the command-line safety check. Use it only after inspecting the PIDs on those ports.

## Frontend Only

If the backend is already healthy:

```powershell
$env:VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:8088'
npm run dev -- --host 127.0.0.1 --port 5173
```

Remove a stale direct-server variable before using the proxy:

```powershell
Remove-Item Env:VITE_SERVER_ADDRESS -ErrorAction SilentlyContinue
```

## CUDA And Model Notes

- Backend preflight must report the expected Python executable, Torch build, CUDA availability, and device name.
- A working CUDA runtime does not prove that a particular model fits VRAM or that every optional quantization kernel is compatible.
- Start with Auto and a lightweight image recipe before installing/running large Qwen, FLUX, Wan, or audio artifacts.
- Put Hugging Face caches and disk offload on a drive with adequate free space; configure paths through the backend, not by moving individual snapshot blobs.
- Restart the backend after changing packages, drivers, or allocator environment variables.

## Validation

Client gates:

```powershell
npm run check
npx playwright install chromium
npm run check:ui
```

Backend smoke:

```powershell
.\.venv\Scripts\python.exe -m modiff.preflight --json --check-port 8088 --fail-on-error
Invoke-RestMethod http://127.0.0.1:8088/health
Invoke-RestMethod http://127.0.0.1:8088/runtime/status
Invoke-RestMethod http://127.0.0.1:8088/nodes | Out-Null
```

Before calling the Gallery functional, also run `npm run test:asset-storage`
and `npm run release:assets:gate`, then confirm its pinned Dataset requests
succeed in a browser where you are not signed into Hugging Face.

For integrated static serving, follow [Build and deployment](deployment.md). For listener, connection, download, and accelerator recovery, see [Troubleshooting](troubleshooting.md).
