#!/usr/bin/env bash
# Linux counterpart of run.bat: install deps if missing, build, launch.
# Extra arguments are passed through (e.g. ./run.sh --hidden).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[run] Node.js was not found on PATH."
  echo "[run] Install Node.js 18+ (e.g. sudo apt install nodejs npm) and try again."
  exit 1
fi

if [ ! -d node_modules/electron ]; then
  echo "[run] Dependencies are missing - running npm install..."
  npm install
fi

echo "[run] Building..."
npm run build

echo "[run] Starting WhatsZAP..."
exec node scripts/launch.cjs "$@"
