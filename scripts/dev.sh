#!/usr/bin/env bash
# Runs the API, the simulated devices and the web app together. Ctrl-C stops all three.
set -euo pipefail
cd "$(dirname "$0")/.."
API_PORT="${API_PORT:-8710}"
export BIOCANARY_API="http://127.0.0.1:${API_PORT}"
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $API_PORT is in use. Set API_PORT to a free port."; exit 1
fi
trap 'kill 0' EXIT INT TERM
(cd backend && exec .venv/bin/uvicorn app.main:app --port "$API_PORT" --log-level warning --timeout-graceful-shutdown 3) &
for _ in $(seq 1 40); do curl -fs "$BIOCANARY_API/api/v1/health" >/dev/null 2>&1 && break; sleep 0.5; done
(cd backend && exec .venv/bin/python -W ignore -m app.simulation.device --interval "${SIM_INTERVAL:-20}") &
(cd frontend && exec npx vite --host 127.0.0.1) &
wait
