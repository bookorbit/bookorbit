#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

E2E_DATABASE_URL="${E2E_DATABASE_URL:-${DATABASE_URL:-postgres://projectx:projectx@localhost:5432/projectx_e2e}}"
JUNIT_OUTPUT="${JUNIT_OUTPUT:-$ROOT_DIR/test-results/server/scanner-file-ops-e2e-junit.xml}"

if [[ "${CI:-}" != "true" ]]; then
  echo "Starting local PostgreSQL (dev compose)..."
  pnpm run db:up
fi

echo "Resetting and migrating dedicated e2e database..."
E2E_DATABASE_URL="$E2E_DATABASE_URL" pnpm run db:prepare:e2e

mkdir -p "$(dirname "$JUNIT_OUTPUT")"

echo "Running scanner file operations e2e suite..."
DATABASE_URL="$E2E_DATABASE_URL" JUNIT_OUTPUT="$JUNIT_OUTPUT" pnpm --filter server test:e2e:scanner:file-ops
