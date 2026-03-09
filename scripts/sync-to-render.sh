#!/bin/bash
# Sync local DB + code to Render (makes Render an exact mirror of local)
# Usage: ./scripts/sync-to-render.sh [--data-only | --code-only]

set -e

LOCAL_DB="postgresql://c2farms:c2farms_dev@localhost:5432/c2farms"
RENDER_DB="postgresql://c2farms:Eegwjhwd9ovZWPNo3fgHnjVVZ4ba7fxO@dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com/c2farms"
DOCKER_CONTAINER="c2farms-postgres-1"
DUMP_FILE="/tmp/c2farms_sync.dump"

sync_code() {
  echo "=== Syncing code ==="
  cd "$(dirname "$0")/.."

  # Check for uncommitted changes
  if [ -n "$(git status --porcelain)" ]; then
    echo "WARNING: You have uncommitted changes. Commit first or they won't reach Render."
    git status --short
    read -p "Push anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      return 1
    fi
  fi

  git push origin main
  echo "Code pushed. Render will auto-deploy."
}

sync_data() {
  echo "=== Syncing database ==="

  # Verify Docker container is running
  if ! docker ps --format '{{.Names}}' | grep -q "$DOCKER_CONTAINER"; then
    echo "ERROR: Docker container $DOCKER_CONTAINER is not running."
    echo "Run: docker compose up -d"
    exit 1
  fi

  # Dump local DB
  echo "Dumping local database..."
  docker exec "$DOCKER_CONTAINER" pg_dump -Fc -U c2farms c2farms > "$DUMP_FILE"
  echo "Dump size: $(du -h "$DUMP_FILE" | cut -f1)"

  # Restore to Render
  echo "Restoring to Render..."
  docker exec -i "$DOCKER_CONTAINER" pg_restore --clean --if-exists --no-owner --no-acl -d "$RENDER_DB" < "$DUMP_FILE" 2>&1 | grep -v "WARNING" || true

  # Verify
  echo "Verifying..."
  LOCAL_USERS=$(docker exec "$DOCKER_CONTAINER" psql "$LOCAL_DB" -t -c "SELECT count(*) FROM users")
  RENDER_USERS=$(docker exec "$DOCKER_CONTAINER" psql "$RENDER_DB" -t -c "SELECT count(*) FROM users")
  LOCAL_FARMS=$(docker exec "$DOCKER_CONTAINER" psql "$LOCAL_DB" -t -c "SELECT count(*) FROM farms")
  RENDER_FARMS=$(docker exec "$DOCKER_CONTAINER" psql "$RENDER_DB" -t -c "SELECT count(*) FROM farms")

  echo "  Users  - Local:$LOCAL_USERS Render:$RENDER_USERS"
  echo "  Farms  - Local:$LOCAL_FARMS Render:$RENDER_FARMS"

  # Cleanup
  rm -f "$DUMP_FILE"
  echo "Database synced."
}

# Parse args
case "${1:-}" in
  --data-only)
    sync_data
    ;;
  --code-only)
    sync_code
    ;;
  *)
    sync_code
    sync_data
    echo ""
    echo "=== Render fully synced ==="
    ;;
esac
