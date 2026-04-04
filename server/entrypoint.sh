#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
fi

export BOOKS_PATH="${BOOKS_PATH:-/data}"
export BOOK_BUCKET_PATH="${BOOK_BUCKET_PATH:-/book-bucket}"

node dist/scripts/migrate.js
exec node dist/main.js
