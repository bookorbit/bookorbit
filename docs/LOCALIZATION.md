# Localization

BookOrbit uses Vue I18n catalogs under `client/src/locales/`. English is the source language, and Crowdin is the source of truth for every other catalog listed below.

## Supported Catalogs

| Application locale   | Crowdin language ID | Catalog   |
| -------------------- | ------------------- | --------- |
| English              | Source language     | `en.json` |
| Czech                | `cs`                | `cs.json` |
| Danish               | `da`                | `da.json` |
| German               | `de`                | `de.json` |
| Spanish              | `es-ES`             | `es.json` |
| Finnish              | `fi`                | `fi.json` |
| French               | `fr`                | `fr.json` |
| Italian              | `it`                | `it.json` |
| Dutch                | `nl`                | `nl.json` |
| Polish               | `pl`                | `pl.json` |
| Brazilian Portuguese | `pt-BR`             | `pt.json` |
| Russian              | `ru`                | `ru.json` |
| Slovenian            | `sl`                | `sl.json` |
| Swedish              | `sv-SE`             | `sv.json` |
| Ukrainian            | `uk`                | `uk.json` |
| Simplified Chinese   | `zh-CN`             | `zh.json` |

Crowdin's `%two_letters_code%` placeholder reduces the regional IDs above to BookOrbit's application locale and filename: `es-ES` to `es`, `pt-BR` to `pt`, `sv-SE` to `sv`, and `zh-CN` to `zh`.

Verify every ID against Crowdin's language list rather than assuming the two-letter form exists. Several languages have no bare two-letter ID at all: Swedish is `sv-SE`, and `sv-FI` reduces to the same `sv.json`, so enabling both would collide.

Chinese ships as Simplified only under the bare `zh` locale, so every `zh-*` browser resolves to it, including Traditional readers. Adding Traditional later means a new `zh-Hant` catalog with a `languages_mapping` entry for `zh-TW`; `zh` keeps its Simplified meaning, so no rename or stored-preference migration is needed. That addition also requires matching by script subtag in `client/src/stores/locale.ts`, because the current base-language fallback would send `zh-Hant` to `zh`.

## Adding User-Facing Copy

Feature branches must:

1. Add the source message to `client/src/locales/en.json`.
2. Add the same English value under the same key in every target catalog as a temporary fallback.
3. Preserve every placeholder and the plural-message structure.
4. Run `pnpm --filter client validate:locales`.

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

Do not use Vue I18n's positional plural argument, pre-format `count`, or add pipe-separated branches. ICU selects CLDR plural categories and formats `#` for the active locale. Every target message must preserve the source arguments and exact selectors such as `=0`, and must include every cardinal category required by its locale. Slovenian therefore includes `one`, `two`, `few`, and `other`; other locales use their own CLDR categories.

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
3. Crowdin exports the target catalogs to `l10n_main`.
4. Crowdin opens a pull request to `main`.
5. CI verifies that the pull request changes only the fifteen target catalogs and runs the normal client checks.
6. A maintainer reviews and squash-merges the pull request.
7. The `.github/workflows/crowdin-branch-cleanup.yml` workflow deletes the `l10n_main` service branch. Crowdin recreates it from the current `main` for the next export.

Deleting that branch is required, not tidiness. Crowdin appends every export to the same service branch and never rebases it, so a branch that outlives its pull request keeps its original merge base. Each later export then diverges further from `main` and eventually conflicts on every catalog. The workflow runs when a pull request from `l10n_main` is closed as well as merged, because Crowdin reuses the branch either way.

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

A catalog may instead arrive already translated, for example from a bulk translation pass. That is allowed, but the translations then exist only in Git and Crowdin will overwrite them unless they are imported first. Follow "Seed existing translations into Crowdin" below before enabling export.

Review `client/src/stores/locale.ts` and add browser-locale matching coverage to `client/src/stores/__tests__/locale.spec.ts`, especially for regional variants.

Each ICU plural message must carry exactly the CLDR categories reported for the locale, plus every exact selector such as `=0` from the English source. Both directions matter:

- A missing category fails `validate:locales`. Czech, Russian, and Ukrainian need `few` and `many` added to every plural message, seeded from the English `other` branch because the source has no corresponding text.
- An extra category leaves Crowdin nowhere to store it, because the editor renders only the categories the locale defines. Chinese has just `other`, so an inherited `one` branch produces a permanent difference that `scripts/crowdin-verify/verify.mjs --reconcile` can never close.

Extend the exhaustive ICU runtime tests in `client/src/i18n/icu.spec.ts` with counts that reach every category. Derive them from `Intl.PluralRules` rather than by analogy, because languages that report the same category set do not map counts the same way: Russian and Ukrainian select `many` for 5 and reach `other` only through a fraction such as 1.5, while Czech selects `other` for 5 and reserves `many` for fractions.

### 4. Seed existing translations into Crowdin

Skip this step when the catalog holds English fallback values. It applies only when the catalog already contains real translations.

Crowdin does not import repository translations on its own, and untranslated strings export as English source text. A pre-translated catalog that is never imported is therefore silently reverted to English by the first export.

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

A language is safe to export only when the script reports zero differing keys. Run it for every seeded language before resuming synchronization.

### 5. Allow Crowdin export and PR delivery

Update `crowdin.yml`:

- Add the exact Crowdin language ID to `export_languages`.
- Add `languages_mapping` when the desired filename is not the language's unique `%two_letters_code%` output.

Update `scripts/classify-crowdin-pr.sh` to allow the new target catalog path. Do not allow `en.json` or broaden the rule to the whole locales directory.

Before merging, add the target language in Crowdin while the current `main` configuration still excludes it from `export_languages`, or pause translation synchronization. Merge the repository support before allowing the first export. After merge, run a manual source and translation sync and confirm that the generated PR changes only explicitly allowed target catalogs.

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
