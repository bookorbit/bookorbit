#!/usr/bin/env bash
set -euo pipefail

# Usage: run-e2e-suite.sh <server-script-name> [extra vitest args...]
#
# Example:
#   bash scripts/test/run-e2e-suite.sh test:e2e:scanner
#   bash scripts/test/run-e2e-suite.sh test:e2e:scanner -- --testNamePattern="book-per-folder-disc-folder-flattening"
#   bash scripts/test/run-e2e-suite.sh test:e2e:scanner:file-ops

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <server-script-name> [extra vitest args...]" >&2
  exit 1
fi

SUITE_SCRIPT="$1"
shift

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

E2E_DATABASE_URL="${E2E_DATABASE_URL:-${DATABASE_URL:-postgres://projectx:projectx@localhost:5432/projectx_e2e}}"

JUNIT_DIR="$ROOT_DIR/test-results/server"
mkdir -p "$JUNIT_DIR"

if [[ "${CI:-}" != "true" ]]; then
  echo "Starting local PostgreSQL (dev compose)..."
  pnpm run db:up
fi

echo "Resetting and migrating dedicated e2e database..."
E2E_DATABASE_URL="$E2E_DATABASE_URL" pnpm run db:prepare:e2e

echo "Running e2e suite: $SUITE_SCRIPT..."
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server "$SUITE_SCRIPT" "$@"
