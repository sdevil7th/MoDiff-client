# Windows Support

Run the MoDiff backend and Vite client on the same Windows workstation. Developers
can use the uv/npm commands below; combined PowerShell launchers are also available.

## Prerequisites

- 64-bit Windows 10/11
- Git
- uv for the developer commands below (no exact version required); it can provision Python 3.12
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

Maintainers publishing these paired changes should commit and push the backend
first, then obtain that backend commit's full SHA with `git rev-parse HEAD` from
`MoDiff`. In `MoDiff-client/.github/workflows/ci.yml`, replace the historical
`ref` under **Check out the matching backend contract** with that actual SHA
before committing and pushing the client. Keep the backend reference immutable;
do not replace it with a branch name or a guessed future SHA. Client CI checks
the paired backend's `uv.lock` and node contracts, so its old backend pin cannot
validate this migration. Pull both corresponding commits on the Windows test
workstation before running the setup and validation commands below.

Private comparison HTML and runtime evidence are kept outside both Git
repositories and do not arrive through `git pull`. Copy a supplied standalone
HTML separately to review its embedded old/new images offline. Its numerical
results apply to the recorded same-host/runtime pairs; Linux ROCm and Windows
CUDA are not guaranteed to produce identical pixels. Record Windows hardware,
runtime and outputs separately, and check migration parity against a matched
same-platform baseline.

## Developer Setup With uv And npm

From a clean backend checkout, install the native NVIDIA profile:

```powershell
uv sync --extra cuda
uv run --extra cuda python -m modiff.preflight --json --check-port 8088 --fail-on-error
uv run --extra cuda python main.py
```

Use `--extra cpu` for CPU development or `--extra xpu` for supported Intel
hardware. Keep the same extra on sync and run. In a second terminal, from
`MoDiff-client`:

```powershell
npm ci
npm run dev
```

Open the URL printed by Vite. Ctrl+C stops each process. These commands do not
require repository PowerShell scripts or an execution-policy change. Transformers
and PEFT are installed with the backend, with no separate activation for normal
image and LoRA workflows. Setup downloads packages, not inference weights.
`uv sync` reconciles the selected environment; use another checkout to test a
different accelerator. The backend's
[developer setup guide](https://github.com/sdevil7th/MoDiff/blob/develop/docs/developer-setup.md)
also documents explicit `uv pip` commands, repair, and uv upgrades.

Windows uses PyTorch's default allocator. MoDiff does not set
`expandable_segments:True` there; explicit operator allocator variables are
preserved. Ordinary image workflows run eager/native SDPA without Triton.
Compilation is optional and must pass an executed kernel probe. Workflows that
require compiled FlexAttention fail before weight allocation when the toolchain
is unavailable. If you choose compilation, match
[triton-windows](https://github.com/triton-lang/triton-windows) to your PyTorch
version and validate an actual compiled GPU operation.

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
- uses and validates the backend's `.venv\Scripts\python.exe`
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

## Optional Runtime Availability And Recovery

The current additional optional-package profiles are not qualified for Windows
installation or activation. In **Setup**, **Optional runtimes** should report
their unavailable target and omit **Install** and **Activate** controls. This is
an expected compatibility limit; ordinary image and LoRA workflows use the
installed base Transformers and PEFT packages. Optional compiler probes are a
separate capability check.

If an existing optional selection reports `repair_required`, return to the
verified base through the normal recovery control:

1. Finish or cancel active and queued runs, then wait until the queue is idle.
2. Run the backend preflight above. Repair missing base packages with the same
   accelerator extra used during setup before attempting the reset.
3. Open **Setup**, find **Optional runtimes**, and choose **Reset to base**.
   Review **Reset optional runtime to base?**, then confirm **Reset**.
4. Wait for restart and reconnection. If a custom unsupervised launch asks for a
   manual restart, restart that backend normally. Verify `/health` and
   `/runtime/status`, then run an ordinary base workflow.

The reset clears active and previous optional selections and keeps installed
optional files. It does not delete models, workflows, or output history. If no
legacy repair state exists, this recovery case is not applicable; do not create
one merely to test the button. Successful install/activation lifecycle evidence
requires a target that actually publishes qualified actions.

## Validation

Client gates:

```powershell
npx playwright install chromium
npm run check
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

Use the cases below for the actual Windows workstation. Start with a model that
fits the machine and keep the template's original dimensions, steps, seed, model
revision, input images, and adapter settings when checking migration parity.

| Case                          | Action and expected result                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean base environment        | Run the uv/npm setup above, open Setup, and create an image template. Transformers and PEFT are available without an optional install or Activate step. Record the selected Torch build and device.                                                                                                                                                   |
| Fresh template graph          | Create a new Gallery workflow and inspect its nodes against [Image template workflows](image-template-workflows.md). Native routes use the current developer stages, including real EncodeInputs and Guidance where supported; documented whole-pipeline exceptions retain their exact recipe. Saved workflows keep their existing nodes.             |
| Repeated Auto runs            | Run the full template, repeat it, then change only the prompt and seed and run again. A compatible resident model must remain usable when current headroom is sufficient. Record the Auto plan and any blocker instead of changing memory policy to hide it.                                                                                          |
| Browser refresh               | Refresh during an active run, then after completion. Connection and queue status recover, the active task stays visible, and its output remains available. Keep the Vite terminal and browser console logs if a live connection fails; a canceled request during page teardown alone is not a backend failure.                                        |
| Stop and recovery             | Start a generation, press Stop, wait for its terminal status, then run again. The second run must not inherit a stuck task or stale busy state.                                                                                                                                                                                                       |
| Model and task branches       | Test the cached image families and input-conditioned branches you intend to use, including edit, ControlNet, and inpaint/outpaint. Check the complete input images, geometry, scheduler, guidance, and revision rather than substituting a lighter recipe.                                                                                            |
| Named LoRAs                   | Run a template with its full ordered adapter set and original scales, then repeat it. Confirm the run receipt retains each artifact identity and adapter name; changing or removing an adapter must affect the next run.                                                                                                                              |
| Optional runtime availability | Current additional Windows package targets report unavailable and expose no Install/Activate action. Ordinary image and LoRA workflows remain base-ready. Record the target and reason; this result is not a successful install/activation lifecycle test.                                                                                            |
| Legacy runtime recovery       | If an existing selection reports `repair_required`, follow **Optional Runtime Availability And Recovery** above and verify the base worker returns ready. Otherwise record this case as not applicable.                                                                                                                                               |
| Optional runtime lifecycle    | Only on a target with published qualified actions, use Setup's Optional runtimes controls. Install must reach a clear final state; Activate must show validation, restart, and reconnection until the replacement worker is ready. Refresh during the job and verify restored progress. Current additional Windows targets do not exercise this case. |
| Eager and optional compile    | Confirm ordinary image generation works without Triton. If testing compilation, run Probe and wait for its executed-kernel result before enabling it. A workflow that requires unsupported compiled attention must report that limitation before loading weights.                                                                                     |

A missing base dependency or an unavailable backend is a setup defect. A reviewed
route that exceeds the workstation's capacity, or needs an unsupported optional
kernel, is a separate compatibility result; capture its exact message and
resource plan. Passing the mocked client gates does not establish Windows GPU
compatibility or image parity. The backend's
[image template validation guide](https://github.com/sdevil7th/MoDiff/blob/develop/docs/image-template-validation.md)
documents paired output comparison and the runtime, recipe, and raw-output
evidence to retain. Historical Gallery examples remain historical until a new
execution has its own matching proof.

For integrated static serving, follow [Build and deployment](deployment.md). For listener, connection, download, and accelerator recovery, see [Troubleshooting](troubleshooting.md).
