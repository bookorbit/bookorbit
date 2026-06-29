#!/bin/sh
set -e

log() {
  echo "BookOrbit startup: $*" >&2
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
  if [ "${BOOKORBIT_FIX_PERMISSIONS:-true}" != "true" ]; then
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
  if ! su-exec "$APP_UID:$APP_GID" sh -c 'touch "$1/.bookorbit-permission-test" && rm -f "$1/.bookorbit-permission-test"' sh "$dir"; then
    log "$dir is not writable by UID:GID $APP_UID:$APP_GID."
    log "Set PUID/PGID to a NAS user with write access, or fix the host folder ownership/ACLs."
    exit 1
  fi
}

check_writable_current_user() {
  dir="$1"
  if ! touch "$dir/.bookorbit-permission-test" || ! rm -f "$dir/.bookorbit-permission-test"; then
    log "$dir is not writable by the current container user $(id -u):$(id -g)."
    log "Remove the compose user override, set PUID/PGID, or fix the host folder ownership/ACLs."
    exit 1
  fi
}

read_memory_limit_bytes() {
  for path in /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
    if [ ! -r "$path" ]; then
      continue
    fi

    value="$(cat "$path" 2>/dev/null || true)"
    case "$value" in
      '' | max | *[!0-9]*) continue ;;
    esac

    # cgroup v1 reports near-2^63 values for unlimited memory.
    if [ "${#value}" -gt 15 ]; then
      continue
    fi

    echo "$value"
    return 0
  done

  return 1
}

auto_old_space_size_mb() {
  limit_bytes="$(read_memory_limit_bytes || true)"
  if [ -z "$limit_bytes" ]; then
    echo 2048
    return 0
  fi

  limit_mb=$((limit_bytes / 1048576))
  if [ "$limit_mb" -lt 1 ]; then
    echo 2048
    return 0
  fi

  if [ "$limit_mb" -lt 512 ]; then
    heap_mb=$((limit_mb / 2))
  elif [ "$limit_mb" -lt 2048 ]; then
    heap_mb=$((limit_mb * 65 / 100))
  else
    heap_mb=$((limit_mb * 75 / 100))
  fi

  if [ "$heap_mb" -lt 128 ]; then
    heap_mb=128
  fi

  echo "$heap_mb"
}

# Percent-encode a single URL component so credentials containing reserved
# characters (#, /, ?, @, :, spaces, ...) don't corrupt the DATABASE_URL.
urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

if [ -z "$DATABASE_URL" ]; then
  encoded_user="$(urlencode "$POSTGRES_USER")"
  encoded_password="$(urlencode "$POSTGRES_PASSWORD")"
  encoded_db="$(urlencode "$POSTGRES_DB")"
  export DATABASE_URL="postgres://${encoded_user}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${encoded_db}"
fi

export APP_DATA_PATH="${APP_DATA_PATH:-/data}"
book_bucket_path="$APP_DATA_PATH/book-bucket"
export HOME="${HOME:-/tmp}"

APP_UID="${PUID:-1000}"
APP_GID="${PGID:-1000}"
NODE_MAX_OLD_SPACE_SIZE="${NODE_MAX_OLD_SPACE_SIZE:-auto}"

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

if [ "$NODE_MAX_OLD_SPACE_SIZE" = "auto" ]; then
  NODE_MAX_OLD_SPACE_SIZE="$(auto_old_space_size_mb)"
  log "using NODE_MAX_OLD_SPACE_SIZE=${NODE_MAX_OLD_SPACE_SIZE} MB from auto detection."
else
  case "$NODE_MAX_OLD_SPACE_SIZE" in
    '' | *[!0-9]*)
      log "NODE_MAX_OLD_SPACE_SIZE must be a numeric MB value or 'auto', got '$NODE_MAX_OLD_SPACE_SIZE'."
      exit 1
      ;;
  esac
fi

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
