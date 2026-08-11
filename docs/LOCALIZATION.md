# Localization

BookOrbit uses Vue I18n catalogs under `client/src/locales/`. English is the source language, and Crowdin is the source of truth for every other catalog listed below.

## Supported Catalogs

| Application locale   | Crowdin language ID | Catalog        |
| -------------------- | ------------------- | -------------- |
| English              | Source language     | `en.json`      |
| Czech                | `cs`                | `cs.json`      |
| Danish               | `da`                | `da.json`      |
| German               | `de`                | `de.json`      |
| Greek                | `el`                | `el.json`      |
| Spanish              | `es-ES`             | `es.json`      |
| Finnish              | `fi`                | `fi.json`      |
| French               | `fr`                | `fr.json`      |
| Hungarian            | `hu`                | `hu.json`      |
| Indonesian           | `id`                | `id.json`      |
| Italian              | `it`                | `it.json`      |
| Japanese             | `ja`                | `ja.json`      |
| Korean               | `ko`                | `ko.json`      |
| Dutch                | `nl`                | `nl.json`      |
| Polish               | `pl`                | `pl.json`      |
| Brazilian Portuguese | `pt-BR`             | `pt.json`      |
| Romanian             | `ro`                | `ro.json`      |
| Russian              | `ru`                | `ru.json`      |
| Slovak               | `sk`                | `sk.json`      |
| Slovenian            | `sl`                | `sl.json`      |
| Swedish              | `sv-SE`             | `sv.json`      |
| Turkish              | `tr`                | `tr.json`      |
| Ukrainian            | `uk`                | `uk.json`      |
| Simplified Chinese   | `zh-CN`             | `zh.json`      |
| Traditional Chinese  | `zh-TW`             | `zh-Hant.json` |

Crowdin's `%two_letters_code%` placeholder reduces the regional IDs above to BookOrbit's application locale and filename: `es-ES` to `es`, `pt-BR` to `pt`, `sv-SE` to `sv`, and `zh-CN` to `zh`.

Verify every ID against Crowdin's language list rather than assuming the two-letter form exists. Several languages have no bare two-letter ID at all: Swedish is `sv-SE`, and `sv-FI` reduces to the same `sv.json`, so enabling both would collide.

Chinese uses separate application locales for each script. Simplified Chinese remains under `zh`, while Traditional Chinese uses `zh-Hant`. The `languages_mapping` entry in `crowdin.yml` maps Crowdin's `zh-TW` target to `zh-Hant.json` so it cannot collide with the Simplified catalog. Browser matching uses explicit or inferred script subtags: `zh-CN` and `zh-SG` resolve to `zh`, while `zh-TW`, `zh-HK`, and `zh-MO` resolve to `zh-Hant`.

## Adding User-Facing Copy

Feature branches must:

1. Add the source message to `client/src/locales/en.json`.
2. Preserve every placeholder and the plural-message structure when editing an existing message.
3. Run `pnpm --filter client validate:locales`.

Do not add the key to target catalogs. Target catalogs are sparse and contain only real Crowdin translations. Vue I18n resolves an absent target key through the complete English catalog, including English ICU plural rules.

CI rejects changes to existing target catalogs in ordinary pull requests. The validated `l10n_main` Crowdin PR is the only routine writer. A normal issue-linked pull request may add an empty catalog only as part of the new-language setup described below.

Do not create or improve target-language translations directly in Git. Crowdin does not continuously import repository translations after initial setup, so a later Crowdin export would overwrite those changes. Apply any emergency target-catalog fix in Crowdin before the next export.

When an English edit changes meaning rather than wording, prefer a new message key. If the key must remain, explicitly invalidate or clear the affected translations in Crowdin so an outdated translation is not exported for the new meaning.

## Plural Messages

Plural messages use ICU MessageFormat:

```text
{count, plural, =0 {No books} one {1 book} other {# books}}
```

Pass the raw numeric value through the interpolation object:

```ts
t("library.bookCount", { count });
```

Do not use Vue I18n's positional plural argument, pre-format `count`, or add pipe-separated branches. ICU selects CLDR plural categories and formats `#` for the active locale. Every translated target message that is present must preserve the source arguments and exact selectors such as `=0`, and must include every cardinal category required by its locale. Slovenian therefore includes `one`, `two`, `few`, and `other`; other locales use their own CLDR categories. An untranslated target message is omitted so Vue I18n formats the English fallback with English plural rules.

Repository validation compiles ordinary Vue I18n messages and rejects malformed syntax. For ICU plurals, it rejects malformed syntax, empty options, changed argument types or styles, changed plural offsets, missing locale categories, mismatched arguments or exact selectors, and legacy pipe branches. It also rejects embedded HTML and Unicode em dash characters. Human review is still required for the wording of each locale's plural branches.

Changing the plural structure of an existing English message, rather than only its wording, invalidates every translation of that key because the target branches no longer match the source. Clear or invalidate the affected translations in Crowdin before the next export so translators re-author them in the new structure.

### Styled Counts

When the count needs its own markup, use `IcuCountText` instead of `<i18n-t>`, because compiled ICU messages cannot bind Vue I18n slots:

```vue
<IcuCountText
  keypath="tools.bulkRename.confirmDialog.body"
  :count="renameCount"
>
  <template #count="{ value }">
    <strong>{{ value }}</strong>
  </template>
</IcuCountText>
```

The component only supplies `count`, so its message must not require other arguments, and validation requires every branch of such a message to render exactly one `#`.

## Translation Delivery

After an English source change reaches `main`:

1. Crowdin synchronizes `client/src/locales/en.json`.
2. Translators update target strings in Crowdin.
3. The scheduled or manually dispatched `Crowdin Translation Sync` workflow verifies that Crowdin's source keys match `en.json`.
4. The workflow requests only translated strings, removes the empty values Crowdin emits for untranslated nested JSON entries, and validates the resulting sparse catalogs.
5. Before writing, the workflow rejects exports that omit an existing translation or replace one with English source text.
6. Only after validation and retention checks pass, the workflow updates `l10n_main` and opens a pull request to `main`.
7. CI verifies that the pull request changes only the twenty-four target catalogs and runs the normal client checks.
8. A maintainer reviews and squash-merges the pull request.
9. The `.github/workflows/crowdin-branch-cleanup.yml` workflow deletes the `l10n_main` service branch. The next export recreates it from the current `main` when translations change.

Deleting that branch is required, not tidiness. It guarantees that every later export starts from the current `main`. The cleanup workflow runs when a pull request from `l10n_main` is closed as well as merged.

Translation pull requests retain the configured `i18n(client)` title and commit format. The `i18n` commit type produces a patch release and an Internationalization release-note section. `CROWDIN_PR_TOKEN` must contain a fine-grained GitHub token with repository contents and pull-request write access. A separate token is required because pull requests created with the workflow's default `GITHUB_TOKEN` do not trigger normal pull-request workflows.

The retention check distinguishes the initial complete legacy catalogs from later sparse catalogs. In a complete legacy catalog, it protects values that differ from English and ignores copied English fallbacks. Once a catalog is sparse, every existing key is treated as an intentional translation, including technical terms that legitimately match English.

An intentional removal requires a manual workflow dispatch with its exact `locale:message.key` value in `allowed_translation_losses`. Separate multiple acknowledgements with commas. Unknown, misspelled, duplicate, and unused acknowledgements fail the run, so this input cannot act as a broad bypass. Scheduled runs never acknowledge translation loss automatically.

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

Create `client/src/locales/<locale>.json` as an empty object. The catalog remains sparse and gains entries only when the controlled Crowdin workflow exports real translations.

A catalog may instead arrive already translated, for example from a bulk translation pass. That is allowed, but the translations then exist only in Git and Crowdin will overwrite them unless they are imported first. Follow "Seed existing translations into Crowdin" below before enabling export.

Review `client/src/stores/locale.ts` and add browser-locale matching coverage to `client/src/stores/__tests__/locale.spec.ts`, especially for regional variants.

Each translated ICU plural message that is present must carry exactly the CLDR categories reported for the locale, plus every exact selector such as `=0` from the English source. Both directions matter:

- A missing category fails `validate:locales`. Czech, Russian, and Ukrainian translations need `few` and `many` in every translated plural message.
- An extra category leaves Crowdin nowhere to store it, because the editor renders only the categories the locale defines. Chinese has just `other`, so an inherited `one` branch produces a permanent difference that `scripts/crowdin-verify/verify.mjs --reconcile` can never close.

Extend the exhaustive ICU runtime tests in `client/src/i18n/icu.spec.ts` with counts that reach every category. Derive them from `Intl.PluralRules` rather than by analogy, because languages that report the same category set do not map counts the same way: Russian and Ukrainian select `many` for 5 and reach `other` only through a fraction such as 1.5, while Czech selects `other` for 5 and reserves `many` for fractions.

### 4. Seed existing translations into Crowdin

This applies only when real translations already exist in Git. English fallback values are omitted rather than imported.

Crowdin does not import repository translations on its own. Without untranslated-string omission, a pre-translated catalog that was never imported can be silently reverted to English by an export. The controlled workflow requests omission and prunes Crowdin's empty nested-JSON placeholders instead.

Order matters, because merging the `crowdin.yml` change enables export for the language:

1. Pause translation synchronization, or keep the language out of `export_languages` until verification passes.
2. Add the target language in Crowdin.
3. Import the catalog with Crowdin's translation import, allowing translations that match the source so entries such as product names and identifiers are not dropped.
4. Verify, reconcile, and only then enable export.

**The progress percentage does not verify anything.** Crowdin's bulk translation import is lossy: it silently skips entries that the per-string translation endpoint accepts. Observed causes include translations that add punctuation the English source lacks, and ICU messages carrying a plural category the source does not use, such as Spanish or Portuguese `many`. A language can report 96 to 98 percent while real translations are missing, and those gaps export as English over good translations in Git.

Verify by building the export and diffing it against the catalog:

```bash
CROWDIN_TOKEN=... node scripts/crowdin-verify/verify.mjs es-ES es.json
```

The script exits non-zero while any key differs. Pass `--reconcile` to push the remaining strings through the per-string endpoint, which accepts what the bulk import rejected:

```bash
CROWDIN_TOKEN=... node scripts/crowdin-verify/verify.mjs es-ES es.json --reconcile
```

A language is safe to export only when every real Git translation is present in Crowdin. Do not reconcile a full legacy catalog blindly because that would record English fallback values as translations.

### 5. Allow Crowdin export and PR delivery

Update `crowdin.yml`:

- Add the exact Crowdin language ID to `export_languages`.
- Add `languages_mapping` when the desired filename is not the language's unique `%two_letters_code%` output.

`TARGET_CATALOGS` is derived from `SUPPORTED_LOCALES`. If the Crowdin language ID differs from the application locale, add the exception to `CROWDIN_LANGUAGE_ID_OVERRIDES` in `client/scripts/locale-configuration.mjs`.

Add the new target catalog path to `.github/workflows/crowdin-translations.yml` and `scripts/classify-crowdin-pr.sh`. Do not allow `en.json` or broaden either rule to the whole locales directory. The synchronization script checks these lists and `crowdin.yml` against the shared locale configuration before contacting Crowdin.

Before merging, add the target language in Crowdin while the current `main` configuration still excludes it from `export_languages`, or pause translation synchronization. Merge the repository support before allowing the first export. After Crowdin synchronizes the new English source, dispatch `Crowdin Translation Sync` manually and confirm that the generated pull request changes only explicitly allowed target catalogs.

### 6. Verify the new language

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
- For a seeded catalog, `scripts/crowdin-verify/verify.mjs` reports zero differing keys.

Only enable scheduled export for the new language after this manual round trip succeeds.

## Crowdin Project Settings

Use the native GitHub integration in **Source and translation files mode** with only `main` connected. Do not use Target file bundles mode or automatic feature-branch discovery. Leave source synchronization enabled, but disable the integration's scheduled translation synchronization and pull-request creation. The repository workflow owns translation export and delivery.

Initial import settings:

- Import existing translations once.
- Allow target translations to match the source.
- Do not continuously import translations from GitHub afterward.
- Keep Push Sources disabled.

Export settings:

- Skip untranslated strings: on.
- Skip untranslated files: off.
- Export only approved translations: off unless the review policy changes explicitly.

Crowdin preserves untranslated nested JSON keys with empty values even when untranslated strings are skipped. `client/scripts/sync-crowdin-translations.mjs` removes those empty entries, restores English source-key ordering, validates every translated message, and refuses to write catalogs if Crowdin has not synchronized the current English keys.

The `Crowdin Translation Sync` workflow requires:

- `CROWDIN_TOKEN`, with permission to read project files, strings, and translation builds.
- `CROWDIN_PR_TOKEN`, a fine-grained GitHub token with repository contents and pull-request write access.
- Optional repository variable `CROWDIN_PROJECT_ID`; the BookOrbit project ID is the script default.

Configure variable mismatches and leading or trailing whitespace as Crowdin QA errors. Keep punctuation and length checks enabled, and include translator instructions for Vue I18n plural branches, the HTML prohibition, and the Unicode em dash prohibition.

Use a daily translation export schedule and manual synchronization before releases. Keep automatic merging disabled.
