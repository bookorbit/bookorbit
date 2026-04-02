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
pnpm run test:e2e -- all               # run all e2e suites sequentially
pnpm run test:e2e -- smoke             # e2e smoke suite (default DB)
pnpm run test:e2e -- scanner           # scanner e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- scanner-file-ops  # scanner file operation e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- staging-ingest-finalize  # staging ingest/finalize e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- opds-auth-catalog # OPDS auth/catalog e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- reader-state-isolation # reader state isolation e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- email-lifecycle   # email lifecycle e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e -- users-admin-lifecycle # users admin lifecycle e2e suite (dedicated projectx_e2e DB)
pnpm run test:e2e:all                  # alias for "pnpm run test:e2e -- all"
pnpm run test:e2e:opds-auth-catalog    # alias for "pnpm run test:e2e -- opds-auth-catalog"
pnpm run test:e2e:reader-state-isolation # alias for "pnpm run test:e2e -- reader-state-isolation"
pnpm run test:e2e:email-lifecycle      # alias for "pnpm run test:e2e -- email-lifecycle"
pnpm run test:e2e:users-admin-lifecycle # alias for "pnpm run test:e2e -- users-admin-lifecycle"
pnpm run test:e2e:list                 # list all supported e2e suite ids
```

Watch mode while working on a specific area:

```bash
cd server && pnpm test:watch
```

Run a focused scanner scenario:

```bash
pnpm run test:e2e -- scanner --testNamePattern=book-per-folder-disc-folder-flattening
```

### E2E runner architecture

- All suite metadata lives in `scripts/test/e2e-suites.mjs` (suite id, spec file, JUnit output, DB prep mode).
- Local and CI use the same command: `pnpm run test:e2e -- <suite-id>`.
- Use `all` as a composite suite id to run every configured suite in order.
- Dedicated-db suites auto-start local PostgreSQL when `CI != true`, then reset and migrate the e2e database through `pnpm run db:prepare:e2e`.
- JUnit outputs are written to `test-results/server/`.

### Scanner e2e details

- `pnpm run test:e2e -- scanner` prepares and migrates a dedicated e2e database (`projectx_e2e`) on each run.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `scanner-e2e-junit.xml`
  - `scanner-e2e-scenarios.json`

### Scanner file operation e2e details

- `pnpm run test:e2e -- scanner-file-ops` prepares and migrates the same dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `scanner-file-ops-e2e-junit.xml`
  - `scanner-file-ops-e2e-scenarios.json`

### Staging ingest/finalize e2e details

- `pnpm run test:e2e -- staging-ingest-finalize` prepares and migrates the dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `staging-ingest-finalize-e2e-junit.xml`
  - `staging-ingest-finalize-e2e-scenarios.json`

### OPDS auth/catalog e2e details

- `pnpm run test:e2e -- opds-auth-catalog` prepares and migrates the dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `opds-auth-catalog-e2e-junit.xml`
  - `opds-auth-catalog-e2e-scenarios.json`

### Reader state isolation e2e details

- `pnpm run test:e2e -- reader-state-isolation` prepares and migrates the dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `reader-state-isolation-e2e-junit.xml`
  - `reader-state-isolation-e2e-scenarios.json`

### Email lifecycle e2e details

- `pnpm run test:e2e -- email-lifecycle` prepares and migrates the dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `email-lifecycle-e2e-junit.xml`
  - `email-lifecycle-e2e-scenarios.json`

### Users admin lifecycle e2e details

- `pnpm run test:e2e -- users-admin-lifecycle` prepares and migrates the dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `users-admin-lifecycle-e2e-junit.xml`
  - `users-admin-lifecycle-e2e-scenarios.json`

### E2E in CI (how to trigger)

All suite workflows call the reusable `E2E Runner (reusable)` workflow, which runs:

```bash
pnpm run test:e2e -- <suite-id>
```

| Workflow                    | Suite id                  | Triggered by                                                                          |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| Scanner E2E                 | `scanner`                 | `workflow_dispatch`, `push` (scanner-related paths), `pull_request` (same paths)      |
| Scanner File Ops E2E        | `scanner-file-ops`        | `workflow_dispatch`, nightly schedule (`0 4 * * *`), `push`, `pull_request`           |
| Staging Ingest Finalize E2E | `staging-ingest-finalize` | `workflow_dispatch`, `push` (staging-related paths), `pull_request` (same paths)      |
| OPDS Auth Catalog E2E       | `opds-auth-catalog`       | `workflow_dispatch`, `push` (opds-related paths), `pull_request` (same paths)         |
| Reader State Isolation E2E  | `reader-state-isolation`  | `workflow_dispatch`, `push` (reader-state-related paths), `pull_request` (same paths) |
| Email Lifecycle E2E         | `email-lifecycle`         | `workflow_dispatch`, `push` (email-related paths), `pull_request` (same paths)        |
| Users Admin Lifecycle E2E   | `users-admin-lifecycle`   | `workflow_dispatch`, `push` (users/auth-related paths), `pull_request` (same paths)   |

Manual trigger steps:

1. Open GitHub Actions.
2. Select **Scanner E2E**, **Scanner File Ops E2E**, **Staging Ingest Finalize E2E**, **OPDS Auth Catalog E2E**, **Reader State Isolation E2E**, **Email Lifecycle E2E**, or **Users Admin Lifecycle E2E**.
3. Click **Run workflow**.

Each run uploads `test-results/server/` as an artifact and publishes JUnit annotations from `test-results/server/*-e2e-junit.xml`.

---

## Code Quality

Run before pushing:

```bash
pnpm run verify:fast       # lint + typecheck + tests (same as pre-push hook)
pnpm run verify            # above + e2e smoke (run before opening a PR)
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
