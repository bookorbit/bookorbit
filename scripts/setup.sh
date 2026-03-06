#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  echo "Created server/.env from server/.env.example"
fi

echo "Installing dependencies..."
pnpm install

echo "Starting PostgreSQL..."
docker compose up -d --wait

echo "Applying migrations..."
pnpm run db:migrate

echo "Seeding baseline data..."
pnpm run db:seed

pnpm run doctor
