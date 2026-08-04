#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${MODIFF_BACKEND_DIR:-}"
BACKEND_PORT=8088
FRONTEND_PORT=5173
FRONTEND_PORT_RANGE=40
SKIP_GPU_CLEANUP=0
STOP_ANY_LISTENER=0

print_usage() {
  cat <<'EOF'
Usage: ./stop-dev.sh [options]

Options:
  --backend-path <path>       MoDiff backend checkout. Defaults to $MODIFF_BACKEND_DIR, ../MoDiff, then ../modiff.
  --backend-port <port>       Backend port. Default: 8088.
  --frontend-port <port>      First frontend port in the Vite range. Default: 5173.
  --frontend-port-range <n>   Number of frontend ports to scan. Default: 40.
  --skip-gpu-cleanup          Do not call /runtime/gpu_cleanup before stopping the backend.
  --stop-any-listener         Stop any listener on the target ports, even if it is not recognized as MoDiff.
  -h, --help                  Show this help.
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
    --frontend-port-range)
      FRONTEND_PORT_RANGE="${2:-}"
      shift 2
      ;;
    --skip-gpu-cleanup)
      SKIP_GPU_CLEANUP=1
      shift
      ;;
    --stop-any-listener)
      STOP_ANY_LISTENER=1
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
SUPERVISOR_PORT="$((BACKEND_PORT + 1))"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_FOR_SCRIPT="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_FOR_SCRIPT="python"
else
  echo "python3 or python is required to run the MoDiff dev shutdown helper." >&2
  exit 1
fi

OS_NAME="$(uname -s 2>/dev/null || echo unknown)"

resolve_optional_dir() {
  local path="$1"
  if [[ -n "$path" && -d "$path" ]]; then
    (cd -- "$path" && pwd -P)
  fi
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

BACKEND_PATH_RESOLVED="$(resolve_optional_dir "$BACKEND_PATH" || true)"
FRONTEND_PATH="$(cd -- "$SCRIPT_DIR" && pwd -P)"
PINNED_BACKEND_PID=""
PINNED_FRONTEND_PID=""

if [[ -f "$PID_FILE" ]]; then
  PINNED_BACKEND_PID="$(grep -E '^BACKEND_PID=[0-9]+$' "$PID_FILE" | head -n 1 | cut -d= -f2 || true)"
  PINNED_FRONTEND_PID="$(grep -E '^FRONTEND_PID=[0-9]+$' "$PID_FILE" | head -n 1 | cut -d= -f2 || true)"
fi

target_ports_csv() {
  local ports=("$BACKEND_PORT" "$SUPERVISOR_PORT")
  local port
  for ((port = FRONTEND_PORT; port < FRONTEND_PORT + FRONTEND_PORT_RANGE; port += 1)); do
    ports+=("$port")
  done
  local IFS=,
  echo "${ports[*]}"
}

scan_linux_listeners() {
  "$PYTHON_FOR_SCRIPT" - "$(target_ports_csv)" <<'PY'
import os
import sys

target_ports = {int(port) for port in sys.argv[1].split(",") if port}
inode_to_ports = {}

def collect_tcp(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()[1:]
    except OSError:
        return

    for line in lines:
        parts = line.split()
        if len(parts) < 10 or parts[3] != "0A":
            continue
        local = parts[1]
        try:
            port = int(local.rsplit(":", 1)[1], 16)
        except (IndexError, ValueError):
            continue
        if port in target_ports:
            inode_to_ports.setdefault(parts[9], set()).add(port)

collect_tcp("/proc/net/tcp")
collect_tcp("/proc/net/tcp6")

seen = set()
for pid in sorted(entry for entry in os.listdir("/proc") if entry.isdigit()):
    fd_dir = f"/proc/{pid}/fd"
    try:
        fds = os.listdir(fd_dir)
    except OSError:
        continue

    matched_ports = set()
    for fd in fds:
        try:
            target = os.readlink(os.path.join(fd_dir, fd))
        except OSError:
            continue
        if not target.startswith("socket:[") or not target.endswith("]"):
            continue
        inode = target[8:-1]
        matched_ports.update(inode_to_ports.get(inode, ()))

    if not matched_ports:
        continue

    try:
        with open(f"/proc/{pid}/cmdline", "rb") as handle:
            cmdline = handle.read().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
    except OSError:
        cmdline = ""

    try:
        with open(f"/proc/{pid}/comm", "r", encoding="utf-8") as handle:
            name = handle.read().strip()
    except OSError:
        name = ""

    try:
        cwd = os.path.realpath(f"/proc/{pid}/cwd")
    except OSError:
        cwd = ""

    for port in sorted(matched_ports):
        key = (port, pid)
        if key in seen:
            continue
        seen.add(key)
        safe_cmdline = cmdline.replace("\t", " ").replace("\n", " ")
        safe_name = name.replace("\t", " ").replace("\n", " ")
        safe_cwd = cwd.replace("\t", " ").replace("\n", " ")
        print(f"{port}\t{pid}\t{safe_name}\t{safe_cmdline}\t{safe_cwd}")
PY
}

scan_darwin_listeners() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  "$PYTHON_FOR_SCRIPT" - "$(target_ports_csv)" <<'PY'
import os
import re
import subprocess
import sys

target_ports = {int(port) for port in sys.argv[1].split(",") if port}

def run_command(args):
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, text=True)
    except Exception:
        return ""

def command_for_pid(pid):
    return run_command(["ps", "-p", pid, "-o", "command="]).strip()

def cwd_for_pid(pid):
    output = run_command(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"])
    for line in output.splitlines():
        if line.startswith("n"):
            return os.path.realpath(line[1:])
    return ""

def port_from_endpoint(endpoint):
    match = re.search(r":(\d+)(?:\s|\)|$)", endpoint)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None

output = run_command(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcnT"])
records = []
pid = ""
name = ""

for raw_line in output.splitlines():
    if not raw_line:
        continue
    tag, value = raw_line[0], raw_line[1:]
    if tag == "p":
        pid = value
        name = ""
    elif tag == "c":
        name = value
    elif tag == "n" and pid:
        port = port_from_endpoint(value)
        if port in target_ports:
            records.append((port, pid, name))

seen = set()
for port, pid, name in sorted(records, key=lambda item: (item[0], int(item[1]) if item[1].isdigit() else 0)):
    key = (port, pid)
    if key in seen:
        continue
    seen.add(key)
    cmdline = command_for_pid(pid)
    cwd = cwd_for_pid(pid)
    safe_cmdline = cmdline.replace("\t", " ").replace("\n", " ")
    safe_name = name.replace("\t", " ").replace("\n", " ")
    safe_cwd = cwd.replace("\t", " ").replace("\n", " ")
    print(f"{port}\t{pid}\t{safe_name}\t{safe_cmdline}\t{safe_cwd}")
PY
}

scan_listeners() {
  case "$OS_NAME" in
    Darwin)
      scan_darwin_listeners
      ;;
    *)
      scan_linux_listeners
      ;;
  esac
}

is_modiff_dev_process() {
  local port="$1"
  local pid="$2"
  local name="$3"
  local cmdline="$4"
  local cwd="$5"

  if [[ "$STOP_ANY_LISTENER" -eq 1 ]]; then
    return 0
  fi

  if [[ -n "$PINNED_BACKEND_PID" && "$pid" == "$PINNED_BACKEND_PID" ]]; then
    return 0
  fi
  if [[ -n "$PINNED_FRONTEND_PID" && "$pid" == "$PINNED_FRONTEND_PID" ]]; then
    return 0
  fi

  if [[ "$port" -eq "$BACKEND_PORT" || "$port" -eq "$SUPERVISOR_PORT" ]]; then
    if [[ "$cmdline" == *"main.py"* ]]; then
      if [[ -z "$BACKEND_PATH_RESOLVED" || "$cwd" == "$BACKEND_PATH_RESOLVED" || "$cmdline" == *"$BACKEND_PATH_RESOLVED"* ]]; then
        return 0
      fi
    fi
    return 1
  fi

  if (( port >= FRONTEND_PORT && port < FRONTEND_PORT + FRONTEND_PORT_RANGE )); then
    # Recent Node versions can expose the main thread as `MainThread` in
    # /proc/<pid>/comm. The executable command and checkout path are the
    # reliable identifiers for a Vite listener, not the thread name.
    if [[ "$cmdline" == *"vite"* && ( "$cwd" == "$FRONTEND_PATH" || "$cmdline" == *"$FRONTEND_PATH"* ) ]]; then
      return 0
    fi
    if [[ "$cmdline" == *"npm"* && "$cmdline" == *"run dev"* && ( "$cwd" == "$FRONTEND_PATH" || "$cmdline" == *"$FRONTEND_PATH"* ) ]]; then
      return 0
    fi
  fi

  return 1
}

invoke_gpu_cleanup() {
  local uri="http://127.0.0.1:$BACKEND_PORT/runtime/gpu_cleanup"
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found; skipping accelerator cleanup request."
    return
  fi

  if ! curl -fsS -X POST --max-time 15 "$uri" >/dev/null; then
    echo "Accelerator cleanup request failed or backend is already stopping."
  fi
}

stop_pid() {
  local pid="$1"
  local label="$2"

  echo "Stopping $label PID $pid"
  kill "$pid" 2>/dev/null || return 0
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done

  echo "PID $pid did not exit after SIGTERM; sending SIGKILL."
  kill -KILL "$pid" 2>/dev/null || true
}

listeners=()
while IFS= read -r line; do
  listeners+=("$line")
done < <(scan_listeners)

if [[ "${#listeners[@]}" -eq 0 ]]; then
  echo "No MoDiff dev listeners found on backend port $BACKEND_PORT or frontend ports $FRONTEND_PORT-$((FRONTEND_PORT + FRONTEND_PORT_RANGE - 1))."
  exit 0
fi

targets=()
skipped=()
for line in "${listeners[@]}"; do
  IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
  if is_modiff_dev_process "$port" "$pid" "$name" "$cmdline" "$cwd"; then
    targets+=("$line")
  else
    skipped+=("$line")
  fi
done

for line in "${skipped[@]}"; do
  IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
  echo "Skipping PID $pid on port $port; command line did not look like a MoDiff dev server. Use --stop-any-listener to stop it anyway."
done

if [[ "${#targets[@]}" -eq 0 ]]; then
  echo "No matching MoDiff dev server processes to stop."
  exit 0
fi

backend_target_found=0
for line in "${targets[@]}"; do
  IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
  if [[ "$port" -eq "$BACKEND_PORT" ]]; then
    backend_target_found=1
  fi
done

if [[ "$SKIP_GPU_CLEANUP" -eq 0 && "$backend_target_found" -eq 1 ]]; then
  invoke_gpu_cleanup
fi

# Stop the supervisor before its worker so it cannot respawn the backend while
# shutdown is in progress.
ordered_targets=()
for line in "${targets[@]}"; do
  IFS=$'\t' read -r port _ <<<"$line"
  if [[ "$port" -eq "$SUPERVISOR_PORT" ]]; then
    ordered_targets+=("$line")
  fi
done
for line in "${targets[@]}"; do
  IFS=$'\t' read -r port _ <<<"$line"
  if [[ "$port" -ne "$SUPERVISOR_PORT" ]]; then
    ordered_targets+=("$line")
  fi
done

stopped_pids=()
for line in "${ordered_targets[@]}"; do
  IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
  if [[ " ${stopped_pids[*]} " == *" $pid "* ]]; then
    continue
  fi
  stopped_pids+=("$pid")
  stop_pid "$pid" "$name on port $port"
done

sleep 0.5
remaining=()
current_listeners=()
while IFS= read -r line; do
  current_listeners+=("$line")
done < <(scan_listeners)
for line in "${current_listeners[@]}"; do
  IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
  if is_modiff_dev_process "$port" "$pid" "$name" "$cmdline" "$cwd"; then
    remaining+=("$line")
  fi
done

if [[ "${#remaining[@]}" -gt 0 ]]; then
  for line in "${remaining[@]}"; do
    IFS=$'\t' read -r port pid name cmdline cwd <<<"$line"
    echo "Still listening: PID $pid on port $port" >&2
  done
  exit 1
fi

echo "MoDiff dev servers stopped."
