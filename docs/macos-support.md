# macOS Support

This repo supports a local-first Apple Silicon macOS setup where the MoDiff backend and this Vite client run on the same machine. Keep the backend bound to `127.0.0.1` for local development and let Vite proxy browser API/websocket traffic to it.

## Prerequisites

Target environment:

- Apple Silicon macOS
- Homebrew
- Node 24.12.0 and npm 11.6.2
- Xcode Command Line Tools
- `ffmpeg`

Install the common Homebrew packages:

```bash
xcode-select --install
brew install node@24 ffmpeg
```

If Homebrew does not put Node 24 first on your `PATH`, use your normal shell
profile to add it before running the development installer.

## Backend Setup

From the backend checkout:

```bash
./install.sh --accelerator mps
./.venv/bin/python -m modiff.preflight --json --check-port 8088 --fail-on-error
./run.sh
```

The Apple Silicon profile keeps the core backend install on normal PyPI wheels so PyTorch can use CPU/MPS support. CUDA-only packages such as `bitsandbytes`, `dfloat11[cuda12]`, Nunchaku, `xformers`, FlashAttention, and SageAttention are not part of the default macOS path.

The installer owns this environment and validates the MPS profile before
promotion. Do not layer a separate pip-managed Torch stack into `.venv`.

Put large model caches on a writable disk with enough space by setting `HF_HOME`, `HF_HUB_CACHE`, or `[huggingface] cache_dir` in `config.ini`. If you change `config.ini`, keep local development on:

```ini
[server]
host = 127.0.0.1
port = 8088
```

Use `host = 0.0.0.0` only for an intentional LAN or remote deployment, and protect it with a firewall or reverse proxy.

## Client Development

From this client checkout:

```bash
chmod +x install-dev.sh run-dev.sh stop-dev.sh
./install-dev.sh --accelerator mps
./run-dev.sh
```

The launcher:

- detects `$MODIFF_BACKEND_DIR`, `../MoDiff`, then `../modiff`
- runs `python -m modiff.preflight --json --check-port 8088 --fail-on-error`
- starts or reuses the backend at `http://127.0.0.1:8088`
- starts Vite on the first available port at or after `5173`
- sets `VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088`
- opens the frontend with the macOS `open` command unless `--no-browser` is passed

If the backend already runs, start only Vite:

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088 npm run dev -- --host 127.0.0.1 --port 5173
```

Stop repo-owned dev processes with:

```bash
./stop-dev.sh
```

On macOS, `stop-dev.sh` uses `lsof` and `ps` instead of Linux `/proc` scanning.

## Runtime Expectations

The backend preflight and `/runtime/status` report Apple MPS availability. Across platforms Studio prefers devices in this order:

1. `cuda:0` when CUDA is available
2. `xpu:0` when Intel XPU is available
3. `mps:0` when Apple MPS is available
4. `cpu:0` otherwise

MPS support is intentionally conservative but usable: model installation and execution are allowed with a visible preview warning, and Auto currently admits only recipes whose accelerator requirement includes MPS. MoDiff moves those pipelines directly to `mps:0` and does not apply CUDA-only CPU-offload hooks. Every exact model, dtype, macOS/PyTorch version, and recipe remains unqualified until a real Apple Silicon run receipt proves it; unsupported operations or memory failures remain possible, especially for large video and quantized CUDA-oriented paths.

## Static Backend Serving

Follow [Build and deployment](deployment.md) to copy generated assets while preserving backend/user-owned web content. Then open `http://127.0.0.1:8088/`.

## Validation

Frontend gates:

```bash
npm run check
npx playwright install chromium
npm run check:ui
```

Backend Apple Silicon smoke:

```bash
./.venv/bin/python -m modiff.preflight --json --check-port 8088 --fail-on-error
./run.sh
curl -fsS http://127.0.0.1:8088/nodes >/dev/null
curl -fsS http://127.0.0.1:8088/runtime/status >/dev/null
```

Integrated app smoke:

```bash
./run-dev.sh --no-browser
curl -fsS http://127.0.0.1:5173/nodes >/dev/null
curl -fsS http://127.0.0.1:5173/runtime/status >/dev/null
```

Run one lightweight MPS graph before calling macOS support verified. Do not claim a model/recipe is optimized or production-qualified on Apple Silicon until a retained real output and exact recipe receipt exist for that host.

See [Troubleshooting](troubleshooting.md) for port, proxy, browser, and runtime recovery. Review [Privacy and security](privacy-and-security.md) before binding either process beyond localhost.
