#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${MODIFF_BACKEND_DIR:-}"
BACKEND_PORT=8088
FRONTEND_PORT=5173
HOST="${MODIFF_DEV_HOST:-}"
BACKEND_WAIT_SECONDS=25
NO_BROWSER=0

configure_rocm_runtime() {
  local paths=()
  local directory
  [[ -d /opt/rocm/lib ]] && paths+=(/opt/rocm/lib)
  for directory in /opt/rocm/core-*/lib; do
    [[ -d "$directory" ]] && paths+=("$directory")
  done
  if (( ${#paths[@]} > 0 )); then
    local joined
    joined="$(IFS=:; echo "${paths[*]}")"
    export LD_LIBRARY_PATH="$joined${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export ROCM_PATH="${ROCM_PATH:-/opt/rocm}"
    export HIP_PATH="${HIP_PATH:-/opt/rocm}"
    export TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL="${TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL:-1}"
  fi
}

configure_rocm_runtime

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

if [[ -z "$HOST" ]]; then
  HOST="127.0.0.1"
fi

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
SUPERVISOR_CONTROL_URL="http://127.0.0.1:$((BACKEND_PORT + 1))"

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
  else
    echo "The managed backend environment is missing. Run ./install-dev.sh --backend-path '$BACKEND_PATH_RESOLVED' first." >&2
    return 2
  fi
}

check_existing_frontend_health() {
  local port="$1"
  local frontend_url="http://127.0.0.1:$port"
  run_backend_python - "$frontend_url" <<'PY'
import json
import sys
import urllib.request

base_url = sys.argv[1]
try:
    with urllib.request.urlopen(f"{base_url}/", timeout=3) as response:
        page = response.read(128 * 1024).decode("utf-8", errors="replace")
    if "<title>MoDiff</title>" not in page:
        raise RuntimeError("the page is not the MoDiff client")
    with urllib.request.urlopen(f"{base_url}/runtime/status", timeout=5) as response:
        runtime = json.load(response)
    if not runtime.get("ready"):
        raise RuntimeError("the proxied backend is not ready")
except Exception:
    raise SystemExit(1)
PY
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

check_existing_backend_health() {
  local health_url="$BACKEND_URL/runtime/status"
  local supervisor_health_url="$SUPERVISOR_CONTROL_URL/health"
  if ! run_backend_python - "$health_url" "$supervisor_health_url" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
supervisor_url = sys.argv[2]
try:
    with urllib.request.urlopen(url, timeout=5) as response:
        payload = json.load(response)
except Exception as exc:
    raise SystemExit(f"Existing backend health check failed: {exc}")

profile = payload.get("runtime_profile")
if not isinstance(profile, dict):
    raise SystemExit("Existing backend does not expose managed runtime-profile validation. Restart it with the current MoDiff backend.")
if not payload.get("ready") or not profile.get("execution_ready"):
    issues = profile.get("issues") if isinstance(profile.get("issues"), list) else []
    messages = [str(item.get("message")) for item in issues if isinstance(item, dict) and item.get("message")]
    repair = profile.get("repair_command")
    detail = " ".join(messages) or "The backend runtime is not ready."
    if repair:
        detail += f" Repair: {repair}"
    raise SystemExit(detail)

try:
    with urllib.request.urlopen(supervisor_url, timeout=2) as response:
        supervisor = json.load(response)
except Exception as exc:
    raise SystemExit(
        "Existing backend does not expose the process-external Stop/recovery control plane. "
        f"Restart it with the current MoDiff backend: {exc}"
    )
if not supervisor.get("ready") or not supervisor.get("workerRunning"):
    raise SystemExit("Existing backend supervisor is not ready. Restart the current MoDiff backend.")
PY
  then
    echo "The backend already using $BACKEND_URL is not safe for execution." >&2
    return 1
  fi
}

start_backend() {
  local log_file="$LOG_DIR/backend.log"
  (
    cd -- "$BACKEND_PATH_RESOLVED"
    export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
    if [[ -x ./.venv/bin/python ]]; then
      exec ./.venv/bin/python main.py
    else
      echo "The managed backend environment is missing. Run the client ./install-dev.sh first." >&2
      exit 2
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
    export VITE_SUPERVISOR_CONTROL_ADDRESS="$SUPERVISOR_CONTROL_URL"
    exec npm run dev -- --host "$HOST" --port "$port"
  ) >"$log_file" 2>&1 &
  echo "$!"
}

first_network_ipv4() {
  local candidate
  while IFS= read -r candidate; do
    if [[ "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$candidate" != 127.* ]]; then
      echo "$candidate"
      return 0
    fi
  done < <(hostname -I 2>/dev/null | tr ' ' '\n')
  return 1
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
  check_existing_backend_health
else
  run_backend_preflight
  BACKEND_PID="$(start_backend)"
  echo "Started backend: $BACKEND_URL (PID $BACKEND_PID)"

  BACKEND_READY=0
  deadline=$((SECONDS + BACKEND_WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if port_listening "$BACKEND_PORT" && (check_existing_backend_health) >/dev/null 2>&1; then
      BACKEND_READY=1
      break
    fi
    sleep 0.5
  done

  if (( BACKEND_READY == 0 )); then
    echo "Backend did not become ready on $BACKEND_URL within $BACKEND_WAIT_SECONDS seconds." >&2
    if port_listening "$BACKEND_PORT"; then
      check_existing_backend_health || true
    fi
    echo "Backend log: $LOG_DIR/backend.log" >&2
    tail -n 80 "$LOG_DIR/backend.log" >&2 || true
    exit 1
  fi
fi

FRONTEND_PID=""
if port_listening "$FRONTEND_PORT" && check_existing_frontend_health "$FRONTEND_PORT"; then
  FRONTEND_PORT_TO_USE="$FRONTEND_PORT"
  echo "Frontend port $FRONTEND_PORT already serves this MoDiff checkout. Reusing it."
else
  FRONTEND_PORT_TO_USE="$(available_frontend_port "$FRONTEND_PORT")"
  FRONTEND_PID="$(start_frontend "$FRONTEND_PORT_TO_USE")"
fi
LOCAL_FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT_TO_USE"
BROWSER_URL="$LOCAL_FRONTEND_URL"
FRONTEND_URL="$LOCAL_FRONTEND_URL"
if [[ "$HOST" == "0.0.0.0" || "$HOST" == "::" ]]; then
  if NETWORK_HOST="$(first_network_ipv4)"; then
    FRONTEND_URL="http://$NETWORK_HOST:$FRONTEND_PORT_TO_USE"
  fi
else
  FRONTEND_URL="http://$HOST:$FRONTEND_PORT_TO_USE"
  BROWSER_URL="$FRONTEND_URL"
fi

cat >"$PID_FILE" <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
BACKEND_PATH=$BACKEND_PATH_RESOLVED
FRONTEND_PATH=$FRONTEND_PATH
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PORT=$FRONTEND_PORT_TO_USE
FRONTEND_HOST=$HOST
EOF

if [[ -n "$FRONTEND_PID" ]]; then
  echo "Started frontend: $FRONTEND_URL (PID $FRONTEND_PID)"
else
  echo "Using frontend: $FRONTEND_URL"
fi
if [[ "$FRONTEND_URL" != "$LOCAL_FRONTEND_URL" ]]; then
  echo "Local frontend: $LOCAL_FRONTEND_URL"
fi
echo "Frontend API target: $BACKEND_URL through the Vite dev proxy"
echo "Supervisor stop target: $SUPERVISOR_CONTROL_URL"
echo "Logs: $LOG_DIR"

if [[ "$NO_BROWSER" -eq 0 ]]; then
  sleep 2
  open_browser "$BROWSER_URL"
fi
