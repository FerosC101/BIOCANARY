#!/usr/bin/env bash
# Installs dependencies, creates the local database and loads demonstration data.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo "Install uv first: https://docs.astral.sh/uv/"; exit 1; }
(cd backend && uv sync -p 3.12 --all-extras && uv run alembic upgrade head && uv run python -W ignore -m app.cli seed-demo)
(cd frontend && npm ci)
echo "Ready. Start with: scripts/dev.sh"
