# Localization

BookOrbit uses Vue I18n catalogs under `client/src/locales/`. English is the source language, and Crowdin is the source of truth for German, Dutch, Brazilian Portuguese, and Slovenian translations.

## Supported Catalogs

| Application locale   | Crowdin language ID | Catalog   |
| -------------------- | ------------------- | --------- |
| English              | Source language     | `en.json` |
| German               | `de`                | `de.json` |
| Dutch                | `nl`                | `nl.json` |
| Brazilian Portuguese | `pt-BR`             | `pt.json` |
| Slovenian            | `sl`                | `sl.json` |

Crowdin's `%two_letters_code%` placeholder maps Brazilian Portuguese to `pt`, which matches BookOrbit's existing application locale and filename.

## Adding User-Facing Copy

Feature branches must:

1. Add the source message to `client/src/locales/en.json`.
2. Add the same English value under the same key in every target catalog as a temporary fallback.
3. Preserve every placeholder and the plural-message structure.
4. Run `pnpm --filter client validate:locales`.

Do not create or improve target-language translations directly in Git. Crowdin does not continuously import repository translations after initial setup, so a later Crowdin export would overwrite those changes. Apply any emergency target-catalog fix in Crowdin before the next export.

When an English edit changes meaning rather than wording, prefer a new message key. If the key must remain, explicitly invalidate or clear the affected translations in Crowdin so an outdated translation is not exported for the new meaning.

## Plural Messages

Vue I18n plural messages use pipe-separated branches:

```text
No books | 1 book | {count} books
```

Crowdin's JSON parser treats this syntax as ordinary text. Translators must preserve the pipe-separated structure and placeholders manually. Locale branch counts can differ; Slovenian commonly needs more branches than English.

Repository validation rejects missing plural structure, empty plural branches, placeholder mismatches, embedded HTML, and Unicode em dash characters. Human review is still required for locale-specific plural semantics.

## Translation Delivery

After an English source change reaches `main`:

1. Crowdin synchronizes `client/src/locales/en.json`.
2. Translators update target strings in Crowdin.
3. Crowdin exports the target catalogs to `l10n_main`.
4. Crowdin opens a pull request to `main`.
5. CI verifies that the pull request changes only the four target catalogs and runs the normal client checks.
6. A maintainer reviews and squash-merges the pull request.
7. The `l10n_main` service branch is deleted. Crowdin recreates it for the next export.

Crowdin pull requests must retain the configured `i18n(client)` title and commit format. The `i18n` commit type produces a patch release and an Internationalization release-note section. Crowdin's default `[ci skip]` commit suffix is disabled so pull-request validation runs before merge.

## Adding a New Language

Add languages through a normal issue-linked pull request before enabling their Crowdin export. This ensures the application, validation, and Crowdin PR allowlist are ready before Crowdin creates the first translation update.

### 1. Choose the locale identifiers

Choose both:

- The application locale and catalog filename, preferably a canonical BCP 47 identifier such as `fr` or `fr-CA`.
- The exact Crowdin language ID shown in Crowdin's language-code reference.

Crowdin's `export_languages` entries use Crowdin language IDs, while `%two_letters_code%` controls the exported filename. If two enabled variants share the same two-letter code, or the application identifier differs from Crowdin's two-letter code, add a per-file `languages_mapping` entry in `crowdin.yml` so exports cannot collide. For example:

```yaml
files:
  - source: /client/src/locales/en.json
    translation: /client/src/locales/%two_letters_code%.json
    languages_mapping:
      two_letters_code:
        fr-CA: fr-CA
```

Never enable two Crowdin languages that resolve to the same catalog path.

### 2. Register the application locale

Update `packages/types/src/locale.ts`:

- Add the application locale to `SUPPORTED_LOCALES`.
- Add its native-language display name to `LOCALE_LABELS`.
- Set `ltr` or `rtl` in `LOCALE_DIRECTIONS`.

The shared locale list automatically updates the language picker, server preference validation, and client locale typing. For an RTL language, manually verify the document direction and responsive layouts in addition to setting `rtl`.

### 3. Add the catalog and locale behavior

Create `client/src/locales/<locale>.json` with the exact key structure from `en.json` and English fallback values. Do not add partial catalogs. Crowdin will replace fallback values as translations are completed.

Review `client/src/stores/locale.ts` and add browser-locale matching coverage to `client/src/stores/__tests__/locale.spec.ts`, especially for regional variants. Vue I18n supplies standard locale pluralization; if the language needs a project-specific rule, register it in `client/src/i18n/index.ts` and add focused tests.

### 4. Allow Crowdin export and PR delivery

Update `crowdin.yml`:

- Add the exact Crowdin language ID to `export_languages`.
- Add `languages_mapping` when the desired filename is not the language's unique `%two_letters_code%` output.

Update `scripts/classify-crowdin-pr.sh` to allow the new target catalog path. Do not allow `en.json` or broaden the rule to the whole locales directory.

Before merging, add the target language in Crowdin while the current `main` configuration still excludes it from `export_languages`, or pause translation synchronization. Merge the repository support before allowing the first export. After merge, run a manual source and translation sync and confirm that the generated PR changes only explicitly allowed target catalogs.

### 5. Verify the new language

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter client validate:locales
pnpm --filter client lint:check
pnpm --filter server lint:check
pnpm typecheck:server
pnpm typecheck:client
pnpm --filter client exec vitest run src/stores/__tests__/locale.spec.ts
pnpm --filter server exec vitest run src/modules/user-preferences/user-preferences.service.test.ts
```

Then verify manually:

- The language picker shows the native label.
- Browser detection selects the intended locale without confusing regional variants.
- Refreshing the application preserves the selected locale.
- `<html lang>` and `<html dir>` are correct.
- Number, date, and relative-time formatting use the intended locale.
- Representative desktop and mobile screens handle translated text expansion.
- RTL layout, keyboard navigation, focus states, dialogs, menus, and popovers remain usable when applicable.
- A manual Crowdin export produces the expected filename and passes all PR checks.

Only enable scheduled export for the new language after this manual round trip succeeds.

## Crowdin Project Settings

Use the native GitHub integration in **Source and translation files mode** with only `main` connected. Do not use Target file bundles mode or automatic feature-branch discovery.

Initial import settings:

- Import existing translations once.
- Allow target translations to match the source.
- Do not continuously import translations from GitHub afterward.
- Keep Push Sources disabled.

Export settings:

- Skip untranslated strings: off.
- Skip untranslated files: off.
- Export only approved translations: off during the initial rollout.

These settings make Crowdin export English source text for untranslated entries instead of empty JSON values, preserving BookOrbit's complete-catalog requirement.

Configure variable mismatches and leading or trailing whitespace as Crowdin QA errors. Keep punctuation and length checks enabled, and include translator instructions for Vue I18n plural branches, the HTML prohibition, and the Unicode em dash prohibition.

Use a daily translation export schedule and manual synchronization before releases. Keep automatic merging disabled.
