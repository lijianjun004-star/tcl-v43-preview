#!/usr/bin/env bash
set -euo pipefail
: "${SITE_ROOT:?Set SITE_ROOT to the extracted candidate ZIP root}"
TASK_PORT="${TCL_TEST_PORT:-18770}"
export TCL_URL="http://127.0.0.1:${TASK_PORT}/tcl-specialty-v33/"
python3 -m http.server "$TASK_PORT" --bind 127.0.0.1 --directory "$SITE_ROOT" >/tmp/tcl-v348-test-server.log 2>&1 &
TASK_SERVER_PID=$!
trap 'kill "$TASK_SERVER_PID" 2>/dev/null || true' EXIT
python3 - "$TASK_PORT" <<'PY'
import socket,sys,time
for _ in range(50):
 try:
  with socket.create_connection(('127.0.0.1',int(sys.argv[1])),timeout=.1): break
 except OSError: time.sleep(.1)
else: raise SystemExit('test server failed')
PY
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$TASK_DIR/v348-barrage-test.cjs" "$SITE_ROOT/tcl-specialty-v33/app.js"
node "$TASK_DIR/test_v348_privacy.cjs"
node "$TASK_DIR/v348-recorder-regression.cjs"
node "$TASK_DIR/v348-asr-regression.cjs"
node "$TASK_DIR/test-integrated.cjs"
python3 "$TASK_DIR/test_v348_ui.py" "$SITE_ROOT/tcl-specialty-v33"
