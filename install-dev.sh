#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BACKEND_PATH="${MODIFF_BACKEND_DIR:-$SCRIPT_DIR/../MoDiff}"
if [[ ! -x "$BACKEND_PATH/install.sh" ]]; then
  echo "MoDiff backend installer not found at $BACKEND_PATH/install.sh" >&2
  exit 2
fi
BACKEND_PATH="$(cd -- "$BACKEND_PATH" && pwd -P)"
"$BACKEND_PATH/install.sh" "$@" --backend-only

PYTHON_BIN="$BACKEND_PATH/.venv/bin/python"
UV_BIN="$(cd -- "$BACKEND_PATH" && "$PYTHON_BIN" -c "from pathlib import Path; from modiff.tool_locks import resolve_uv; print(resolve_uv(Path('.modiff')))")"
"$UV_BIN" pip install \
  --python "$PYTHON_BIN" \
  -r "$BACKEND_PATH/requirements/test.txt"

cd -- "$SCRIPT_DIR"
npm ci
mkdir -p artifacts/dev-install-current
"$PYTHON_BIN" -m modiff.preflight --json --fail-on-error > artifacts/dev-install-current/backend-preflight.json
echo "Development environment is ready. Run ./run-dev.sh."
