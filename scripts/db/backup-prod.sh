#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env.prod}"
OUT_DIR="${2:-$ROOT_DIR/local/backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

mkdir -p "$OUT_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$OUT_DIR/projectx-${POSTGRES_DB}-${timestamp}.dump"

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --wait postgres
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$backup_file"

echo "Backup created: $backup_file"
