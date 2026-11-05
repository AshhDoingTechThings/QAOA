#!/usr/bin/env bash
# One-command launcher: creates the virtualenv on first run, then starts the
# FastAPI backend, which also serves the 3D frontend at http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r backend/requirements.txt
fi
PORT="${PORT:-8000}"
echo "→ Open http://localhost:${PORT}"
cd backend
exec ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT}" "$@"
