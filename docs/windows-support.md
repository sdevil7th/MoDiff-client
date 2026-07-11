# Windows Support

This repository supports a local Windows setup where the MoDiff backend and Vite client run on the same workstation. The combined PowerShell launcher is the recommended development path.

## Prerequisites

- 64-bit Windows 10/11
- Git
- PowerShell 5.1 or PowerShell 7+
- Node.js `24.12.0` and npm `11.6.2`
- Python 3.12
- [`uv`](https://docs.astral.sh/uv/) for the backend environment
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

## Backend Setup

From the backend checkout:

```powershell
uv sync --frozen
uv run python -m modiff.preflight --json --check-port 8088 --fail-on-error
```

Install only the optional groups required by your workflows. For example:

```powershell
uv sync --frozen --extra cuda --extra quantization
```

The backend defaults to `127.0.0.1:8088` and local data paths. To customize them:

```powershell
Copy-Item config.example.ini config.ini
```

`config.ini` is ignored and can contain machine-local paths or a Hugging Face read token. Keep it private. Prefer a least-privilege token and do not paste it into prompts, logs, screenshots, or issues.

## Client Setup And Launch

From `MoDiff-client`:

```powershell
npm ci
.\run-dev.ps1
```

The launcher:

- detects the sibling backend or accepts `-BackendPath`
- uses the backend `.venv\Scripts\python.exe`, `uv`, or `python` in that order
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
uv run python -m modiff.preflight --json --check-port 8088 --fail-on-error
Invoke-RestMethod http://127.0.0.1:8088/health
Invoke-RestMethod http://127.0.0.1:8088/runtime/status
Invoke-RestMethod http://127.0.0.1:8088/nodes | Out-Null
```

For integrated static serving, follow [Build and deployment](deployment.md). For listener, connection, download, and accelerator recovery, see [Troubleshooting](troubleshooting.md).
