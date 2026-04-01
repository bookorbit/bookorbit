#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgres://projectx:projectx@localhost:5432/projectx_e2e}"

echo "Preparing dedicated e2e database..."
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server db:prepare:e2e

echo "Applying migrations to e2e database..."
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server db:migrate
