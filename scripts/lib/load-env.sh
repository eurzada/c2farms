#!/bin/bash
# Loads the repo-root .env (untracked) so scripts get RENDER_DB_URL etc.
# Works under cron, where no shell profile is loaded.
_ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env"
if [ -f "$_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$_ENV_FILE"
  set +a
fi
: "${RENDER_DB_URL:?RENDER_DB_URL is not set. Add it to $_ENV_FILE (see .env.example)}"
