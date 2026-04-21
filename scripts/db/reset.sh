#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_USER="${POSTGRES_USER:-bookorbit}"
POSTGRES_DB="${POSTGRES_DB:-bookorbit}"

echo "Ensuring PostgreSQL is running..."
docker compose -f docker-compose.dev.yml up -d --wait postgres

echo "Resetting database schema..."
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE SCHEMA IF NOT EXISTS drizzle;"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);"
docker compose -f docker-compose.dev.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM drizzle.__drizzle_migrations;"

echo "Re-applying migrations..."
pnpm run db:migrate

echo "Re-seeding baseline data..."
pnpm run db:seed

echo "Cleaning generated local data (covers, authors)..."
rm -rf "$ROOT_DIR/local/data/covers" && mkdir -p "$ROOT_DIR/local/data/covers"
rm -rf "$ROOT_DIR/local/data/book-bucket/covers" && mkdir -p "$ROOT_DIR/local/data/book-bucket/covers"
rm -rf "$ROOT_DIR/local/data/authors" && mkdir -p "$ROOT_DIR/local/data/authors"
rm -rf "$ROOT_DIR/local/data/book-bucket/authors" && mkdir -p "$ROOT_DIR/local/data/book-bucket/authors"

echo "Database reset complete."
