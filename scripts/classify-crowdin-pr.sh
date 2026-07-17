#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 5 ]]; then
  echo "usage: $0 <base-sha> <head-sha> <base-repo> <head-repo> <head-branch>" >&2
  exit 2
fi

BASE_SHA="$1"
HEAD_SHA="$2"
BASE_REPO="$3"
HEAD_REPO="$4"
HEAD_BRANCH="$5"

if [[ "$HEAD_REPO" != "$BASE_REPO" || "$HEAD_BRANCH" != "l10n_main" ]]; then
  echo "false"
  exit 0
fi

allowed_paths=(
  "client/src/locales/de.json"
  "client/src/locales/nl.json"
  "client/src/locales/pt.json"
  "client/src/locales/sl.json"
)

is_allowed_path() {
  local candidate="$1"
  local allowed

  for allowed in "${allowed_paths[@]}"; do
    if [[ "$candidate" == "$allowed" ]]; then
      return 0
    fi
  done

  return 1
}

changed_paths=()
while IFS= read -r -d '' path; do
  changed_paths+=("$path")
done < <(git diff --name-only -z "$BASE_SHA" "$HEAD_SHA")

if [[ "${#changed_paths[@]}" -eq 0 ]]; then
  echo "::error::Crowdin pull request does not contain any changed translation catalogs." >&2
  exit 1
fi

for path in "${changed_paths[@]}"; do
  if ! is_allowed_path "$path"; then
    echo "::error::Crowdin pull request contains disallowed path '$path'." >&2
    exit 1
  fi

  mode="$(git ls-tree "$HEAD_SHA" -- "$path" | awk '{print $1}')"
  if [[ "$mode" != "100644" ]]; then
    echo "::error::Crowdin pull request must retain '$path' as a regular non-executable file." >&2
    exit 1
  fi
done

echo "true"
