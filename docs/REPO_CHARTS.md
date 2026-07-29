# Repository Charts

BookOrbit renders its README charts in the repository instead of depending on
external chart or badge services.

## Storage

The `generated-charts` branch contains the generated files:

- `star-history.json`: validated daily aggregate star counts and source metadata
- `star-history.svg`: the self-contained star history chart
- `translation-progress.svg`: the self-contained Crowdin translation chart

The workflow creates normal commits on this branch. It does not force-push, so
previous chart data remains recoverable without adding automated commits to
`main`.

The bootstrap snapshot at `scripts/star-history/bootstrap.json` contains the
initial exact aggregate history. It is used only when no published series
exists. Raw stargazer records and GitHub usernames are never stored.

## Refresh behavior

The `Repo Charts` workflow runs daily and can also be dispatched manually. It
restores the published series, regenerates both charts, and publishes the
changed files in one branch commit. Nothing is pushed when both charts are
byte-identical to the published copies.

Each generator runs independently. If one fails, the other still publishes and
the failed chart keeps its previously published copy, while the workflow run is
marked as failed.

### Star history

The star history generator obtains the current repository star count, replaces
any existing point for the current UTC date, and renders the SVG.

The built-in workflow token is sufficient for daily snapshots. An optional
`STAR_HISTORY_TOKEN` repository secret belonging to a collaborator enables
exact-history refreshes from GitHub's timestamped stargazer endpoint. Exact
refreshes replace the aggregate curve and correct any drift from previous
snapshots. If the endpoint is unavailable, the workflow retains the stored
history and falls back to the current count.

The generator refuses malformed series, data for a different repository,
future points, invalid API responses, and exact histories beyond GitHub's
pagination limit.

### Translation progress

The translation generator reads public Crowdin project statistics and renders
every language the project exposes, so no code change is needed when a language
is added. English is pinned first at 100% as the source language and is
excluded from the average, though it renders like any other completed row.

Every language is one horizontal meter row, so the card grows in height as
languages are added rather than switching layout. The label column is measured
from the widest language name and long names are truncated, which keeps the bar
from being squeezed out. Bars carry three progress tiers, listed in a legend on
the card: complete at 100%, in progress at 70% or above, and needs work below
that. Three is the ceiling; a fourth tier would need an amber that sits at
deuteranopia delta-E 1.4 against the orange, which no threshold tuning can
separate.

## Local commands

Run the focused test suites:

```bash
pnpm run test:charts
```

Generate the star history chart from a stored series and the current count:

```bash
GITHUB_TOKEN=... node scripts/star-history/generate.mjs \
  --repo bookorbit/bookorbit \
  --series star-history.json \
  --bootstrap scripts/star-history/bootstrap.json \
  --out star-history.svg
```

Set `STAR_HISTORY_TOKEN` as well to attempt a complete exact-history refresh.

Generate the translation chart from live Crowdin statistics:

```bash
node scripts/crowdin-stats/generate.mjs --out translation-progress.svg
```
