#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${MODIFF_BACKEND_DIR:-}"
BACKEND_PORT=8088
FRONTEND_PORT=5173
HOST="127.0.0.1"
BACKEND_WAIT_SECONDS=25
NO_BROWSER=0

print_usage() {
  cat <<'EOF'
Usage: ./run-dev.sh [options]

Options:
  --backend-path <path>      MoDiff backend checkout. Defaults to $MODIFF_BACKEND_DIR, ../MoDiff, then ../modiff.
  --backend-port <port>      Backend port. Default: 8088.
  --frontend-port <port>     First frontend port to try. Default: 5173.
  --host <host>              Vite bind host. Default: 127.0.0.1.
  --backend-wait-seconds <n> Seconds to wait for backend startup. Default: 25.
  --no-browser               Do not open a browser.
  -h, --help                 Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-path)
      BACKEND_PATH="${2:-}"
      shift 2
      ;;
    --backend-port)
      BACKEND_PORT="${2:-}"
      shift 2
      ;;
    --frontend-port)
      FRONTEND_PORT="${2:-}"
      shift 2
      ;;
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --backend-wait-seconds)
      BACKEND_WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    --no-browser)
      NO_BROWSER=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LOG_DIR="$SCRIPT_DIR/artifacts/dev-server-current"
PID_FILE="$LOG_DIR/dev-pids.env"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_FOR_SCRIPT="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_FOR_SCRIPT="python"
else
  echo "python3 or python is required to run the MoDiff dev launcher." >&2
  exit 1
fi

resolve_dir() {
  local path="$1"
  (cd -- "$path" && pwd -P)
}

if [[ -z "$BACKEND_PATH" ]]; then
  if [[ -d "$SCRIPT_DIR/../MoDiff" ]]; then
    BACKEND_PATH="$SCRIPT_DIR/../MoDiff"
  elif [[ -d "$SCRIPT_DIR/../modiff" ]]; then
    BACKEND_PATH="$SCRIPT_DIR/../modiff"
  else
    BACKEND_PATH="$SCRIPT_DIR/../MoDiff"
  fi
fi

if [[ ! -d "$BACKEND_PATH" ]]; then
  echo "Backend path not found: $BACKEND_PATH" >&2
  exit 1
fi

FRONTEND_PATH="$(resolve_dir "$SCRIPT_DIR")"
BACKEND_PATH_RESOLVED="$(resolve_dir "$BACKEND_PATH")"
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"

port_listening() {
  local port="$1"
  "$PYTHON_FOR_SCRIPT" - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
for host in ("127.0.0.1", "::1"):
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    try:
        with socket.create_connection((host, port), timeout=0.35):
            sys.exit(0)
    except OSError:
        pass
sys.exit(1)
PY
}

port_available_for_bind() {
  local host="$1"
  local port="$2"
  "$PYTHON_FOR_SCRIPT" - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
family = socket.AF_INET6 if ":" in host else socket.AF_INET
try:
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.bind((host, port))
except OSError:
    sys.exit(1)
sys.exit(0)
PY
}

available_frontend_port() {
  local start_port="$1"
  local port
  for ((port = start_port; port < start_port + 30; port += 1)); do
    if port_available_for_bind "$HOST" "$port"; then
      echo "$port"
      return 0
    fi
  done

  echo "Could not find a free frontend port starting at $start_port." >&2
  return 1
}

run_backend_python() {
  if [[ -x "$BACKEND_PATH_RESOLVED/.venv/bin/python" ]]; then
    "$BACKEND_PATH_RESOLVED/.venv/bin/python" "$@"
  elif command -v uv >/dev/null 2>&1; then
    uv run python "$@"
  elif command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  else
    python "$@"
  fi
}

run_backend_preflight() {
  local stdout_file="$LOG_DIR/backend-preflight.json"
  local stderr_file="$LOG_DIR/backend-preflight.err.log"

  mkdir -p "$LOG_DIR"
  if ! (
    cd -- "$BACKEND_PATH_RESOLVED"
    run_backend_python -m modiff.preflight --json --check-port "$BACKEND_PORT" --fail-on-error
  ) >"$stdout_file" 2>"$stderr_file"; then
    echo "Backend preflight failed. Report: $stdout_file" >&2
    if [[ -s "$stderr_file" ]]; then
      cat "$stderr_file" >&2
    fi
    if [[ -s "$stdout_file" ]]; then
      cat "$stdout_file" >&2
    fi
    exit 1
  fi

  echo "Backend preflight ready. Report: $stdout_file"
}

start_backend() {
  local log_file="$LOG_DIR/backend.log"
  (
    cd -- "$BACKEND_PATH_RESOLVED"
    export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
    if [[ -x ./.venv/bin/python ]]; then
      exec ./.venv/bin/python main.py
    elif command -v uv >/dev/null 2>&1; then
      exec uv run main.py
    elif command -v python3 >/dev/null 2>&1; then
      exec python3 main.py
    else
      exec python main.py
    fi
  ) >"$log_file" 2>&1 &
  echo "$!"
}

start_frontend() {
  local port="$1"
  local log_file="$LOG_DIR/frontend.log"
  (
    cd -- "$FRONTEND_PATH"
    unset VITE_SERVER_ADDRESS
    export VITE_BACKEND_PROXY_TARGET="$BACKEND_URL"
    exec npm run dev -- --host "$HOST" --port "$port"
  ) >"$log_file" 2>&1 &
  echo "$!"
}

open_browser() {
  local url="$1"
  if [[ -n "${BROWSER:-}" ]]; then
    "$BROWSER" "$url" >/dev/null 2>&1 &
  elif [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  else
    echo "Browser opener not found. Open $url manually."
  fi
}

mkdir -p "$LOG_DIR"

BACKEND_PID=""
if port_listening "$BACKEND_PORT"; then
  echo "Backend port $BACKEND_PORT is already in use. Not starting another backend."
else
  run_backend_preflight
  BACKEND_PID="$(start_backend)"
  echo "Started backend: $BACKEND_URL (PID $BACKEND_PID)"

  deadline=$((SECONDS + BACKEND_WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if port_listening "$BACKEND_PORT"; then
      break
    fi
    sleep 0.5
  done

  if ! port_listening "$BACKEND_PORT"; then
    echo "Backend did not start listening on $BACKEND_URL within $BACKEND_WAIT_SECONDS seconds." >&2
    echo "Backend log: $LOG_DIR/backend.log" >&2
    tail -n 80 "$LOG_DIR/backend.log" >&2 || true
  fi
fi

FRONTEND_PORT_TO_USE="$(available_frontend_port "$FRONTEND_PORT")"
FRONTEND_PID="$(start_frontend "$FRONTEND_PORT_TO_USE")"
BROWSER_HOST="$HOST"
if [[ "$BROWSER_HOST" == "0.0.0.0" || "$BROWSER_HOST" == "::" ]]; then
  BROWSER_HOST="127.0.0.1"
fi
FRONTEND_URL="http://$BROWSER_HOST:$FRONTEND_PORT_TO_USE"

cat >"$PID_FILE" <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
BACKEND_PATH=$BACKEND_PATH_RESOLVED
FRONTEND_PATH=$FRONTEND_PATH
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PORT=$FRONTEND_PORT_TO_USE
EOF

echo "Started frontend: $FRONTEND_URL (PID $FRONTEND_PID)"
echo "Frontend API target: $BACKEND_URL through the Vite dev proxy"
echo "Logs: $LOG_DIR"

if [[ "$NO_BROWSER" -eq 0 ]]; then
  sleep 2
  open_browser "$FRONTEND_URL"
fi
