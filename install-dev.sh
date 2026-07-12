#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BACKEND_PATH="${MODIFF_BACKEND_DIR:-$SCRIPT_DIR/../MoDiff}"
if [[ ! -x "$BACKEND_PATH/install.sh" ]]; then
  echo "MoDiff backend installer not found at $BACKEND_PATH/install.sh" >&2
  exit 2
fi
"$BACKEND_PATH/install.sh" "$@"
cd -- "$SCRIPT_DIR"
npm ci
mkdir -p artifacts/dev-install-current
"$BACKEND_PATH/.venv/bin/python" -m modiff.preflight --json --fail-on-error > artifacts/dev-install-current/backend-preflight.json
echo "Development environment is ready. Run ./run-dev.sh."
