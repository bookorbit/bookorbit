#!/usr/bin/env bash
# Brings every catalog in line with the template: new strings arrive
# untranslated or as fuzzy drafts (never shown until a translator confirms
# them), and strings the plugin no longer uses are removed.
# Usage: update.sh [language...]   Default: every catalog.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
catalogs="$here/../bookorbit.koplugin/l10n"
pot="$here/bookorbit.pot"

if ! command -v msgmerge >/dev/null 2>&1; then
    echo "msgmerge not found: install GNU gettext (brew install gettext, apt install gettext)" >&2
    exit 1
fi

if [ "$#" -gt 0 ]; then
    files=()
    for lang in "$@"; do files+=("$catalogs/$lang.po"); done
else
    files=("$catalogs"/*.po)
fi

for po in "${files[@]}"; do
    [ -f "$po" ] || { echo "no catalog: ${po#"$here/../"}" >&2; exit 1; }
    msgmerge --quiet --update --backup=none --previous --no-wrap --add-location=file "$po" "$pot"
    msgattrib --no-obsolete --no-wrap --output-file="$po" "$po"
    printf '%s: %s\n' "$(basename "$po" .po)" "$(msgfmt --statistics -o /dev/null "$po" 2>&1)"
done
