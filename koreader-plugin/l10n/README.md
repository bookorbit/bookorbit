# Translating the KOReader plugin

The BookOrbit plugin for KOReader is translated here, in Git, by the people who use it. There is no
translation service: you edit a gettext catalog and open a pull request. The plugin shows each string
in KOReader's interface language when its catalog has it, then KOReader's own translation of the same
text, then English. A partial catalog is fine; whatever it lacks stays English on the device.

The web app is translated separately, in Crowdin; see [LOCALIZATION.md](../../docs/LOCALIZATION.md).

## Files

| File                                                    | What it is                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `koreader-plugin/l10n/bookorbit.pot`                    | The template: every English string in the plugin. Generated; never edit it by hand. |
| `koreader-plugin/bookorbit.koplugin/l10n/<code>.po`     | One catalog per language, named with KOReader's code for it.                        |
| `koreader-plugin/bookorbit.koplugin/l10n/languages.lua` | One row per language: its plural rule.                                              |

## Languages

| Language | Catalog | Reviewers       |
| -------- | ------- | --------------- |
| Spanish  | `es.po` | Reviewer wanted |
| Russian  | `ru.po` | Reviewer wanted |

The Spanish catalog was first translated by zeedif, and the Russian one by ezhkov-ph.

## Update a language

With [Poedit](https://poedit.net) (free):

1. Fork the repository and clone your fork.
2. Open `koreader-plugin/bookorbit.koplugin/l10n/<code>.po` in Poedit.
3. Choose **Translation > Update from POT File** and pick `koreader-plugin/l10n/bookorbit.pot`. New
   strings appear untranslated; strings whose English changed appear as **Needs work**.
4. Translate, and confirm or fix every **Needs work** entry. An entry left in that state is a draft
   and is never shown.
5. Save. Commit only the `.po` file; Poedit's `.mo` file is not used.

Without Poedit, `pnpm koreader:l10n:update <code>` (needs GNU gettext) brings the catalog up to date
with the template, and any text editor can do the rest.

## Add a language

1. Find KOReader's code for the language: the folder name in
   [koreader-translations](https://github.com/koreader/koreader-translations), such as `de`,
   `pt_BR` or `zh_CN`. The catalog must use exactly that code, or the plugin never loads it.
2. Copy the `Plural-Forms` header from that folder's `koreader.po`, and add a row for the language to
   `languages.lua` with that header, its number of forms, and the same rule written in Lua. The
   Spanish and Russian rows show the pattern.
3. Create the catalog from the template: in Poedit, **File > New from POT/PO File**; or
   `msginit --no-translator --no-wrap -l <code> -i koreader-plugin/l10n/bookorbit.pot -o koreader-plugin/bookorbit.koplugin/l10n/<code>.po`.
   Set its `Plural-Forms` header to the same text as in `languages.lua`, and `Language` to the code.
4. Translate as much as you like, then add yourself as the reviewer in the table above.

## Rules

- Keep every `%1`, `%2`... marker. You may move them, and you must keep all of them. In a plural,
  every form your language also uses for numbers other than 1 keeps the plural's markers: Russian
  uses its first form for 21, so `%1 день` keeps `%1`.
- Fill every plural form your language has.
- Read the context (`msgctxt`) and the translator notes. The same English can need different
  translations: a month on its own ("November") and a month inside a date ("24 November") are
  separate entries, so languages that change the month there (Russian uses the genitive, Spanish
  lower case) can.
- Product names stay in English: BookOrbit, KOReader, SmartScopes, Kobo.
- Space is tight on e-reader screens. Prefer the shorter wording, and check long strings on a device.
- Do not add links, domains or HTML that the English does not have, and do not use the em dash
  (U+2014); use a hyphen, colon or comma.

## Try it on a device

Copy your `.po` file into `koreader/plugins/bookorbit.koplugin/l10n/` on the device, set KOReader's
language to yours, and restart KOReader. **Technical details** in the plugin's menu shows the language,
the catalog in use and how many strings it has. A plugin update from your server replaces the folder,
so copy the file again after one.

## Check before you open a pull request

```bash
pnpm koreader:l10n:check
```

It needs LuaJIT and GNU gettext, and prints each language's coverage. CI runs the same check on every
pull request, so you can rely on it instead.

## Pull requests

- A pull request that only changes catalogs, `languages.lua` and this guide needs no issue and no
  `BO-` branch name. Every other check still runs.
- Title it like `feat(koreader): add German translation` or `fix(koreader): improve Spanish wording`.
- Review: CI passes and the language's reviewer or another native speaker approves. A brand-new
  language is merged once CI passes, and its author becomes its reviewer.
- Translations reach devices with the next plugin version, which maintainers raise at release.

## For developers

- Translate through `require("bookorbit_gettext")`: `_("Text")`, `T(_.ngettext("1 book", "%1 books", n), n)`
  for a count, and `_.pgettext("Context", "Text")` when the same English needs different translations
  in different places. Never `require("gettext")`, KOReader's, directly.
- Write whole sentences with markers, never fragments glued together: `T(_("%1 of %2"), a, b)`, not
  `a .. _(" of ") .. b`. For a bold value inside a sentence, use `BoardUI.styled`.
- Never take weekday or month names from `os.date`; use KOReader's translations or
  `bookorbit_dates`.
- Explain anything a translator cannot see in a `-- TRANSLATORS:` comment on the line before.
- Run `pnpm koreader:l10n:extract` and commit the template with the code change. Do not edit `.po`
  files in a feature pull request; translators bring them up to date.
- `spec/bookorbit_l10n_guard_test.lua` fails on the patterns above.

To find text that is not translatable, or that does not fit, add
`["bookorbit_pseudo_translation"] = true` to `settings.reader.lua` in KOReader's settings folder
and restart. Every plugin string then shows as a pseudo-translation, `[Šýñç ñóŵ ~~~]`: accented,
about a third longer and bracketed. Plain English is text that skips the translation, and a missing
closing bracket is text that does not fit. Remove the line to go back.
