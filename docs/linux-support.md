# Ubuntu Linux Support

This repo supports a local-first Ubuntu setup where the MoDiff backend and this Vite client run on the same Linux host. Keep the backend bound to `127.0.0.1` for local development and let Vite proxy browser API/websocket traffic to it.

## Prerequisites

Target environment:

- Ubuntu 22.04 or 24.04 x86_64
- Node 24.12.0 and npm 11.6.2
- A driver/runtime supported by the backend's selected NVIDIA, qualified AMD
  ROCm, preview Intel XPU, or CPU profile
- `ffmpeg`, `libgl1`, and `libglib2.0-0` for image/video dependencies

Useful Ubuntu packages:

```bash
sudo apt update
sudo apt install -y git curl build-essential ffmpeg libgl1 libglib2.0-0
```

The backend installer bootstraps a hash-verified local uv and Python 3.12 when
needed. Install Node 24.12.0 with your normal system tooling. CUDA toolkit/NVCC
is only required for optional packages that compile native CUDA extensions.

## Backend Setup

From the backend checkout:

```bash
./install.sh --accelerator auto
./.venv/bin/python -m modiff.preflight --json --check-port 8088 --fail-on-error
./run.sh
```

Inspect profile selection without changing the machine:

```bash
./install.sh --accelerator auto --dry-run --system-check --json
```

Supported Intel Arc and integrated graphics can be selected explicitly with
`./install.sh --accelerator intel`. This is a preview XPU path: preflight must
pass a real `xpu:0` tensor, integrated devices are planned as shared memory, and
CUDA-only Diffusers CPU-offload hooks stay disabled.

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
./install-dev.sh --accelerator auto
./run-dev.sh
```

The launcher:

- detects `$MODIFF_BACKEND_DIR`, `../MoDiff`, then `../modiff`
- runs `python -m modiff.preflight --json --check-port 8088 --fail-on-error`
- starts or reuses the backend at `http://127.0.0.1:8088`
- starts Vite on the first available port at or after `5173`
- sets `VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088`

If the backend already runs, start only Vite:

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088 npm run dev -- --host 127.0.0.1 --port 5173
```

Stop repo-owned dev processes with:

```bash
./stop-dev.sh
```

## Static Backend Serving

Follow [Build and deployment](deployment.md) to copy generated assets while preserving backend/user-owned web content. Then open `http://127.0.0.1:8088/`.

## Validation

Frontend gates:

```bash
npm run check
npx playwright install chromium
npm run check:ui
```

Backend smoke:

```bash
./.venv/bin/python -m modiff.preflight --json --check-port 8088 --fail-on-error
curl -fsS http://127.0.0.1:8088/nodes >/dev/null
curl -fsS http://127.0.0.1:8088/runtime/status >/dev/null
```

For GPU validation, check `/runtime/status` for Torch CUDA availability, confirm the Studio hardware guidance, then run one Z-Image text-to-image workflow through the UI and verify that the output appears in Studio/Gallery.

See [Troubleshooting](troubleshooting.md) for port, proxy, model, and accelerator recovery. Review [Privacy and security](privacy-and-security.md) before binding either process beyond localhost.
