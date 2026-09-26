#!/bin/sh

FILE_ENV_MAX_BYTES=65536

# POSIX sh has no `local`, so clear the working values instead of leaving secrets
# readable in the calling shell.
file_env_reset() {
  unset file_env_name file_var_name direct_value file_path file_value file_size
}

file_env() {
  file_env_name="$1"
  file_var_name="${file_env_name}_FILE"
  direct_value="$(printenv "$file_env_name" 2>/dev/null || true)"
  file_path="$(printenv "$file_var_name" 2>/dev/null || true)"

  if [ -n "$direct_value" ] && [ -n "$file_path" ]; then
    echo "BookOrbit startup: $file_env_name and $file_var_name are mutually exclusive." >&2
    file_env_reset
    return 1
  fi

  if [ -n "$direct_value" ] || [ -z "$file_path" ]; then
    file_env_reset
    return 0
  fi

  if [ ! -f "$file_path" ] || [ ! -r "$file_path" ]; then
    echo "BookOrbit startup: $file_var_name must point to a readable regular file." >&2
    file_env_reset
    return 1
  fi

  file_size="$(wc -c < "$file_path" | tr -d '[:space:]')"
  case "$file_size" in
    '' | *[!0-9]*)
      echo "BookOrbit startup: could not determine the size of $file_var_name." >&2
      file_env_reset
      return 1
      ;;
  esac

  if [ "$file_size" -gt "$FILE_ENV_MAX_BYTES" ]; then
    echo "BookOrbit startup: $file_var_name exceeds the ${FILE_ENV_MAX_BYTES}-byte limit." >&2
    file_env_reset
    return 1
  fi

  file_value="$(cat < "$file_path")"
  if [ -z "$file_value" ]; then
    echo "BookOrbit startup: $file_var_name points to an empty file." >&2
    file_env_reset
    return 1
  fi

  export "$file_env_name=$file_value"
  unset "$file_var_name"
  file_env_reset
}

load_file_env() {
  for pending_env_name in \
    BOOK_REQUEST_ENCRYPTION_KEY \
    DATABASE_URL \
    EMAIL_ENCRYPTION_KEY \
    GITHUB_RELEASES_TOKEN \
    JWT_SECRET \
    MIGRATION_ENCRYPTION_KEY \
    PODCAST_ENCRYPTION_KEY \
    POSTGRES_PASSWORD \
    SETUP_BOOTSTRAP_TOKEN
  do
    if ! file_env "$pending_env_name"; then
      unset pending_env_name
      return 1
    fi
  done

  unset pending_env_name
}
