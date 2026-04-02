# Development Guide

## Prerequisites

- Node.js >= 24
- pnpm >= 9
- Docker

---

## First-time Setup

```bash
pnpm setup
```

This creates `server/.env` from the example, installs all dependencies, starts PostgreSQL, runs migrations, and seeds baseline data.

If you prefer to do it manually:

```bash
pnpm run db:up                        # start PostgreSQL
cp server/.env.example server/.env   # first time only
pnpm install
pnpm run db:migrate
pnpm run db:seed
```

---

## Running the App

```bash
pnpm dev
```

Starts the server and client concurrently with hot reload.

| Service | URL                       |
| ------- | ------------------------- |
| API     | http://localhost:3000/api |
| Client  | http://localhost:5173     |

If PostgreSQL stopped (e.g. after a machine restart):

```bash
pnpm run db:up    # then pnpm dev
```

---

## Database Workflows

### Apply pending migrations

After pulling changes that include new migrations:

```bash
pnpm run db:migrate
```

### Add a schema change

1. Edit the relevant file in `server/src/db/schema/`
2. Generate a migration:
   ```bash
   cd server && pnpm db:generate add-book-tags
   ```
   This creates a new SQL file in `server/src/db/migrations/`. Review it before applying.
3. Apply it:
   ```bash
   pnpm run db:migrate
   ```

> **Pre-launch rule:** Before the app ships, maintain a single baseline migration (`0000_*.sql`) rather than stacking incremental ones. When adding a schema change pre-launch:
>
> ```bash
> rm -rf server/src/db/migrations
> docker compose -f docker-compose.dev.yml down -v
> pnpm run db:up
> cd server && pnpm db:generate baseline
> pnpm run db:migrate
> ```
>
> After go-live, never wipe migrations. Every change gets its own incremental migration.

### Full database reset

Wipes all data, re-runs migrations, re-seeds, and clears generated files (covers, author images):

```bash
pnpm run db:reset
```

Use this when:

- Migrations are in a broken or inconsistent state
- A migration requires starting from scratch (e.g. column type change with no clean upgrade path)
- You want a known-clean local state

### Inspect the database

```bash
cd server && pnpm db:studio
```

Opens Drizzle Studio in your browser for browsing and editing tables directly.

---

## Testing

```bash
pnpm run test              # all tests (server + client)
pnpm run test:server       # server unit tests only
pnpm run test:client       # client unit tests only
pnpm run e2e:run -- all                      # run all e2e suites sequentially
pnpm run e2e:run -- app-smoke                # app smoke suite (default DB)
pnpm run e2e:run -- scanner-scenarios        # scanner scenario suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- scanner-file-operations  # scanner file operation suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- auth-session-security    # auth session security suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- auth-recovery-oidc-logout # auth recovery and OIDC logout suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- staging-ingest-finalize  # staging ingest/finalize suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- metadata-write           # metadata write suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- authorization-matrix     # authorization matrix suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- opds-auth-catalog        # OPDS auth/catalog suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- reader-state-isolation   # reader state isolation suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- email-lifecycle          # email lifecycle suite (dedicated projectx_e2e DB)
pnpm run e2e:run -- users-admin-lifecycle    # users admin lifecycle suite (dedicated projectx_e2e DB)
pnpm run e2e:all                             # shortcut for running all suites
pnpm run e2e:list                            # list supported suite ids
```

Watch mode while working on a specific area:

```bash
cd server && pnpm test:watch
```

Run a focused scanner scenario:

```bash
pnpm run e2e:run -- scanner-scenarios --testNamePattern=book-per-folder-disc-folder-flattening
```

### E2E runner architecture

- All suite metadata lives in `scripts/test/e2e-suites.mjs` (suite id, spec file, JUnit output, DB prep mode).
- Local and CI use the same command: `pnpm run e2e:run -- <suite-id>`.
- Use `all` as a composite suite id to run every configured suite in order, or use `pnpm run e2e:all`.
- Dedicated-db suites auto-start local PostgreSQL when `CI != true`, then reset and migrate the e2e database through `pnpm run e2e:db:prepare`.
- JUnit outputs are written to `test-results/server/`.

### E2E suite details

All suites write JUnit XML to `test-results/server/`. Dedicated-db suites also auto-start PostgreSQL locally (when needed) and use the `projectx_e2e` database.

| Suite id                    | DB mode      | JUnit output                              | Extra artifacts                              |
| --------------------------- | ------------ | ----------------------------------------- | -------------------------------------------- |
| `app-smoke`                 | default-db   | `app-smoke-e2e-junit.xml`                 | none                                         |
| `scanner-scenarios`         | dedicated-db | `scanner-scenarios-e2e-junit.xml`         | `scanner-scenarios-e2e-scenarios.json`       |
| `scanner-file-operations`   | dedicated-db | `scanner-file-operations-e2e-junit.xml`   | `scanner-file-operations-e2e-scenarios.json` |
| `auth-session-security`     | dedicated-db | `auth-session-security-e2e-junit.xml`     | none                                         |
| `auth-recovery-oidc-logout` | dedicated-db | `auth-recovery-oidc-logout-e2e-junit.xml` | none                                         |
| `staging-ingest-finalize`   | dedicated-db | `staging-ingest-finalize-e2e-junit.xml`   | `staging-ingest-finalize-e2e-scenarios.json` |
| `metadata-write`            | dedicated-db | `metadata-write-e2e-junit.xml`            | `metadata-write-e2e-scenarios.json`          |
| `authorization-matrix`      | dedicated-db | `authorization-matrix-e2e-junit.xml`      | none                                         |
| `opds-auth-catalog`         | dedicated-db | `opds-auth-catalog-e2e-junit.xml`         | `opds-auth-catalog-e2e-scenarios.json`       |
| `reader-state-isolation`    | dedicated-db | `reader-state-isolation-e2e-junit.xml`    | `reader-state-isolation-e2e-scenarios.json`  |
| `email-lifecycle`           | dedicated-db | `email-lifecycle-e2e-junit.xml`           | `email-lifecycle-e2e-scenarios.json`         |
| `users-admin-lifecycle`     | dedicated-db | `users-admin-lifecycle-e2e-junit.xml`     | `users-admin-lifecycle-e2e-scenarios.json`   |

### E2E in CI (how to trigger)

All suite workflows call the reusable `E2E Runner (reusable)` workflow, which runs:

```bash
pnpm run e2e:run -- <suite-id>
```

| Workflow name                     | Suite id                    | Triggered by                                                                |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `E2E - App Smoke`                 | `app-smoke`                 | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Scanner Scenarios`         | `scanner-scenarios`         | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Scanner File Operations`   | `scanner-file-operations`   | `workflow_dispatch`, nightly schedule (`0 4 * * *`), `push`, `pull_request` |
| `E2E - Auth Session Security`     | `auth-session-security`     | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Auth Recovery OIDC Logout` | `auth-recovery-oidc-logout` | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Staging Ingest Finalize`   | `staging-ingest-finalize`   | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Metadata Write`            | `metadata-write`            | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Authorization Matrix`      | `authorization-matrix`      | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - OPDS Auth Catalog`         | `opds-auth-catalog`         | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Reader State Isolation`    | `reader-state-isolation`    | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Email Lifecycle`           | `email-lifecycle`           | `workflow_dispatch`, `push`, `pull_request`                                 |
| `E2E - Users Admin Lifecycle`     | `users-admin-lifecycle`     | `workflow_dispatch`, `push`, `pull_request`                                 |

Manual trigger steps:

1. Open GitHub Actions.
2. Select any `E2E - ...` workflow for the suite you want to run.
3. Click **Run workflow**.

Each run uploads `test-results/server/` as an artifact and publishes JUnit annotations from `test-results/server/*-e2e-junit.xml`.

---

## Code Quality

Run before pushing:

```bash
pnpm run verify:fast       # lint + typecheck + tests (same as pre-push hook)
pnpm run verify            # above + e2e app-smoke suite (run before opening a PR)
```

Individual checks:

```bash
pnpm run lint:check        # check for lint errors
pnpm run lint:fix          # auto-fix lint errors
pnpm run typecheck         # server + client baseline typecheck
pnpm run typecheck:full    # server + full client typecheck (slower)
```

Format:

```bash
cd server && npx prettier --write .
cd client && npx prettier --write .
```

---

## Common Scenarios

### Pulled changes that include a new migration

```bash
pnpm run db:migrate
```

### Pulled changes that changed the DB schema significantly and your local state is stale

```bash
pnpm run db:reset
```

### Something is wrong and you want a completely clean slate

```bash
pnpm run db:reset
```

If that is not enough (e.g. Docker volume is corrupted):

```bash
docker compose -f docker-compose.dev.yml down -v
pnpm run db:up
pnpm run db:migrate
pnpm run db:seed
```
