# server scripts

One-off and operational scripts, run from the `server/` directory via the `pnpm` scripts in
`server/package.json` (or directly with `tsx src/scripts/<file>.ts`).

## What's New release tooling

These validate and preview a release's `## Highlights` section before you publish it. Full
authoring walkthrough and format reference: [docs/whats-new-authoring-guide.md](../../../docs/whats-new-authoring-guide.md).

| Command                                                       | What it does                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm whats-new:check <tag>`                                  | One-stop: lints, then previews, the release for `<tag>`. Exits non-zero if the lint fails. |
| `pnpm whats-new:lint <file.md>` \| `--tag <tag>` `[--strict]` | Static validation with the same parser the app uses. `--strict` fails on warnings too.     |
| `pnpm whats-new:preview [tag]` `[--repo owner/name]`          | Renders exactly what the app will show and probes each media URL for reachability.         |

Each accepts `--help`. They read `GITHUB_RELEASES_REPO`, `GITHUB_RELEASES_TOKEN`, and
`APP_VERSION` from `server/.env`; point them at another repo with `GITHUB_RELEASES_REPO=owner/name`
(or `--repo owner/name` for `preview`).

```bash
cd server
pnpm whats-new:check v4.5.0                                   # lint + preview the release
pnpm whats-new:lint notes.md --strict                        # validate a draft locally
GITHUB_RELEASES_REPO=neonsolstice/playground pnpm whats-new:preview v4.2.0
```

## Other scripts

| File                                 | Run with                                             | Purpose                                       |
| ------------------------------------ | ---------------------------------------------------- | --------------------------------------------- |
| `db-seed.ts`                         | `pnpm db:seed`                                       | Seed the dev database.                        |
| `seed-apple-source-stats.ts`         | `pnpm db:seed:apple-stats`                           | Seed realistic iOS and Watch reading history. |
| `db-prepare-e2e.ts`                  | `pnpm e2e:db:prepare`                                | Prepare the e2e test database.                |
| `migrate.ts`                         | `pnpm db:migrate:runtime` (compiled)                 | Apply database migrations at runtime/startup. |
| `setup-kobo-cloudscraper.ts`         | `pnpm setup:kobo-cloudscraper`                       | Set up the Kobo cloudscraper integration.     |
| `backfill-reading-session-events.ts` | `tsx src/scripts/backfill-reading-session-events.ts` | One-off backfill of reading-session events.   |
| `bench-user-statistics.ts`           | `tsx src/scripts/bench-user-statistics.ts`           | Benchmark the user-statistics queries.        |
