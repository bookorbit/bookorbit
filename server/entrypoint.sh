#!/bin/sh
set -e

log() {
  echo "ProjectX startup: $*" >&2
}

ensure_dir() {
  dir="$1"
  if ! mkdir -p "$dir"; then
    log "cannot create $dir. Grant the host directory write access, or set PUID/PGID to a user that can write there."
    exit 1
  fi
}

is_managed_data_path() {
  case "$1" in
    /data | /data/* | /tmp | /tmp/*) return 0 ;;
    *) return 1 ;;
  esac
}

fix_owner() {
  dir="$1"
  if [ "${PROJECTX_FIX_PERMISSIONS:-true}" != "true" ]; then
    return 0
  fi
  if ! is_managed_data_path "$dir"; then
    log "skipping ownership fix for $dir because it is outside /data."
    return 0
  fi
  if ! chown -R "$APP_UID:$APP_GID" "$dir"; then
    log "could not update ownership for $dir. Startup will continue only if UID:GID $APP_UID:$APP_GID can already write there."
  fi
}

check_writable_as_user() {
  dir="$1"
  if ! su-exec "$APP_UID:$APP_GID" sh -c 'touch "$1/.projectx-permission-test" && rm -f "$1/.projectx-permission-test"' sh "$dir"; then
    log "$dir is not writable by UID:GID $APP_UID:$APP_GID."
    log "Set PUID/PGID to a NAS user with write access, or fix the host folder ownership/ACLs."
    exit 1
  fi
}

check_writable_current_user() {
  dir="$1"
  if ! touch "$dir/.projectx-permission-test" || ! rm -f "$dir/.projectx-permission-test"; then
    log "$dir is not writable by the current container user $(id -u):$(id -g)."
    log "Remove the compose user override, set PUID/PGID, or fix the host folder ownership/ACLs."
    exit 1
  fi
}

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"
fi

export APP_DATA_PATH="${APP_DATA_PATH:-/data}"
book_bucket_path="$APP_DATA_PATH/book-bucket"
export HOME="${HOME:-/tmp}"

APP_UID="${PUID:-1000}"
APP_GID="${PGID:-1000}"
NODE_MAX_OLD_SPACE_SIZE="${NODE_MAX_OLD_SPACE_SIZE:-2048}"

case "$APP_UID" in
  '' | *[!0-9]*)
    log "PUID must be a numeric UID, got '$APP_UID'."
    exit 1
    ;;
esac

case "$APP_GID" in
  '' | *[!0-9]*)
    log "PGID must be a numeric GID, got '$APP_GID'."
    exit 1
    ;;
esac

case "$NODE_MAX_OLD_SPACE_SIZE" in
  '' | *[!0-9]*)
    log "NODE_MAX_OLD_SPACE_SIZE must be a numeric MB value, got '$NODE_MAX_OLD_SPACE_SIZE'."
    exit 1
    ;;
esac

if [ "$NODE_MAX_OLD_SPACE_SIZE" -lt 1 ]; then
  log "NODE_MAX_OLD_SPACE_SIZE must be greater than 0."
  exit 1
fi

export NODE_MAX_OLD_SPACE_SIZE

ensure_dir "$APP_DATA_PATH"
ensure_dir "$APP_DATA_PATH/covers"
ensure_dir "$book_bucket_path"

if [ "$(id -u)" = "0" ]; then
  fix_owner "$APP_DATA_PATH"
  fix_owner "$book_bucket_path"
  check_writable_as_user "$APP_DATA_PATH"
  check_writable_as_user "$APP_DATA_PATH/covers"
  check_writable_as_user "$book_bucket_path"
  exec su-exec "$APP_UID:$APP_GID" sh -c 'node dist/scripts/migrate.js && exec node --max-old-space-size="$NODE_MAX_OLD_SPACE_SIZE" dist/main.js'
fi

check_writable_current_user "$APP_DATA_PATH"
check_writable_current_user "$APP_DATA_PATH/covers"
check_writable_current_user "$book_bucket_path"
node dist/scripts/migrate.js
exec node --max-old-space-size="$NODE_MAX_OLD_SPACE_SIZE" dist/main.js
