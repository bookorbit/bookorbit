#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env.prod}"
BACKUP_FILE="${2:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <env-file> <backup-file.dump>" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

test_db="${POSTGRES_DB}_restore_test_$(date -u +%Y%m%d%H%M%S)"

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --wait postgres
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$test_db\";" >/dev/null

cleanup() {
  docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$test_db\";" >/dev/null || true
}
trap cleanup EXIT

cat "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$test_db" --no-owner --no-privileges >/dev/null

table_count="$(
  docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$test_db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
)"

echo "Restore test succeeded: $BACKUP_FILE -> $test_db (${table_count} public tables)"
