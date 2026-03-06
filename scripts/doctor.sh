#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Checking toolchain..."
node -v
pnpm -v

echo "Checking environment files..."
[[ -f server/.env.example ]] || { echo "Missing server/.env.example"; exit 1; }
[[ -f server/.env ]] || { echo "Missing server/.env (run: pnpm setup)"; exit 1; }

echo "Checking PostgreSQL container..."
docker compose ps postgres

POSTGRES_USER="${POSTGRES_USER:-projectx}"
POSTGRES_DB="${POSTGRES_DB:-projectx}"
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "Checking local scripts..."
[[ -d scripts/db ]] || { echo "Missing scripts/db helpers"; exit 1; }
[[ -f scripts/help.mjs ]] || { echo "Missing scripts/help.mjs"; exit 1; }

echo "Doctor check passed."
