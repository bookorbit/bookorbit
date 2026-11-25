#!/usr/bin/env bash
# Prints true when a pull request changes only KOReader plugin translations:
# catalogs, the languages table and the translator guide. Such a pull request
# needs no linked issue or BO- branch; every other check still runs.
# Usage: classify-translation-pr.sh <base-sha> <head-sha>

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

merge_base="$(git merge-base "$1" "$2")"
changed="$(git diff --name-only "$merge_base" "$2")"

if [[ -z "$changed" ]]; then
  echo "false"
  exit 0
fi

while IFS= read -r path; do
  if [[ "$path" =~ ^koreader-plugin/bookorbit\.koplugin/l10n/[A-Za-z_]+\.po$ ]] ||
    [[ "$path" == "koreader-plugin/bookorbit.koplugin/l10n/languages.lua" ]] ||
    [[ "$path" == "koreader-plugin/l10n/README.md" ]]; then
    continue
  fi
  echo "false"
  exit 0
done <<<"$changed"

echo "true"
