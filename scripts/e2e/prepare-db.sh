#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgres://bookorbit:bookorbit@localhost:5432/bookorbit_e2e}"

echo "Preparing dedicated e2e database..."
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server e2e:db:prepare

echo "Applying migrations to e2e database..."
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server e2e:db:migrate
