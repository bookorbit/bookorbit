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
pnpm run test:e2e:smoke    # e2e smoke suite (requires running DB)
pnpm run test:e2e:scanner  # scanner e2e suite (uses dedicated projectx_e2e DB)
pnpm run test:e2e:scanner:file-ops  # scanner file operation e2e suite
```

Watch mode while working on a specific area:

```bash
cd server && pnpm test:watch
```

### Scanner e2e details

- `pnpm run test:e2e:scanner` prepares and migrates a dedicated e2e database (`projectx_e2e`) on each run.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `scanner-e2e-junit.xml`
  - `scanner-e2e-scenarios.json`

### Scanner file operation e2e details

- `pnpm run test:e2e:scanner:file-ops` prepares and migrates the same dedicated e2e database (`projectx_e2e`) before running.
- Local runs auto-start PostgreSQL with `docker-compose.dev.yml` if needed.
- Results are written to `test-results/server/`:
  - `scanner-file-ops-e2e-junit.xml`
  - `scanner-file-ops-e2e-scenarios.json`

### Scanner e2e in CI (manual)

- Open GitHub Actions and run the **Scanner E2E** workflow manually (`workflow_dispatch`).
- The workflow runs the full scanner scenario matrix against a service-container Postgres instance.
- It uploads `test-results/server/` as an artifact and publishes JUnit annotations.

### Scanner file operation e2e in CI

- Open GitHub Actions and run the **Scanner File Ops E2E** workflow manually (`workflow_dispatch`) or wait for the nightly run.
- The workflow runs the full file operation matrix against a service-container Postgres instance.
- It uploads `test-results/server/` as an artifact and publishes JUnit annotations.

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
