#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preview_dir="$repo_dir/storage/local-preview"
python="$repo_dir/.venv/bin/python"

if [[ ! -f "$preview_dir/preview.sqlite" || ! -f "$repo_dir/frontend/.env.development.local" || ! -x "$python" ]]; then
  printf 'Local preview data, credentials, or Python environment is missing.\n' >&2
  exit 1
fi

export DATABASE_URL="sqlite:///$preview_dir/preview.sqlite"
export COOKIE_SECURE=false
export CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
export STORAGE_PATH="$preview_dir/storage"

cd "$repo_dir/backend"
"$python" -m alembic upgrade head
"$python" -m uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT

cd "$repo_dir/frontend"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort