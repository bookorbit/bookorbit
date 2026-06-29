# Development Guide

Everything you need to work in this codebase: architecture, setup, workflows, conventions, and commands.

For the contribution process (issues, PRs, review), see [CONTRIBUTING.md](CONTRIBUTING.md). For test architecture and E2E suite details, see [TESTING.md](TESTING.md).

---

## Architecture Overview

BookOrbit is a pnpm monorepo with three workspaces: a Vue 3 single-page app, a NestJS API server, and a shared types package.

```mermaid
graph LR
    Client["Client<br/><small>Vue 3 SPA</small><br/><small>localhost:5173</small>"]
    Server["Server<br/><small>NestJS + Fastify</small><br/><small>localhost:3000/api</small>"]
    DB["PostgreSQL<br/><small>Drizzle ORM</small>"]
    WS["WebSocket<br/><small>Socket.IO</small>"]
    Types["Shared Types<br/><small>@bookorbit/types</small>"]

    Client -- "HTTP (fetch)" --> Server
    Client <-. "real-time events" .-> WS
    Server --> DB
    Server --> WS
    Types -.- Client
    Types -.- Server
```

| Layer        | Tech                            | Location          |
| ------------ | ------------------------------- | ----------------- |
| Frontend     | Vue 3, Tailwind CSS v4, Vite    | `client/`         |
| Backend      | NestJS 11, Fastify, Drizzle ORM | `server/`         |
| Database     | PostgreSQL 16, pgvector         | Docker container  |
| Shared types | TypeScript                      | `packages/types/` |
| Real-time    | Socket.IO                       | Server + Client   |

---

## Project Structure

```text
bookorbit/
├── client/                  # Vue 3 frontend
│   └── src/
│       ├── features/        # Feature modules (composables + components)
│       ├── components/ui/   # Shared UI components
│       ├── lib/             # API client, utilities
│       ├── router/          # Vue Router config
│       └── assets/          # Tailwind theme, static assets
├── server/                  # NestJS backend
│   └── src/
│       ├── modules/         # Feature modules (controller + service + dto)
│       ├── db/
│       │   ├── schema/      # Drizzle table definitions (one file per domain)
│       │   └── migrations/  # Generated SQL migrations
│       ├── common/          # Guards, filters, decorators, pipes
│       └── config/          # Typed config (app, db, auth)
│   └── test/
│       ├── e2e/             # E2E test helpers and harness
│       └── *.e2e-spec.ts    # E2E test suites
├── packages/
│   └── types/               # Shared TypeScript types
│       └── src/             # Exported via @bookorbit/types
├── scripts/                 # Bootstrap, DB reset, E2E orchestration
├── docker/                  # Postgres init scripts (extensions)
├── .github/                 # CI workflows, PR/issue templates
└── .husky/                  # Git hooks (pre-commit, pre-push)
```

> **Shared types** live in `packages/types/` and are imported as `@bookorbit/types`. Never duplicate types between client and server.

---

## Prerequisites

- **Node.js** >= 24 - [nodejs.org](https://nodejs.org)
- **pnpm** >= 9 - `npm install -g pnpm` (or see [pnpm.io](https://pnpm.io/installation))
- **Docker** - [docs.docker.com/get-started/get-docker](https://docs.docker.com/get-started/get-docker/)

---

## First-Time Setup

### Option A: One Command

```bash
pnpm setup
```

This runs all the steps below automatically. If it succeeds, skip to [Running the App](#running-the-app).

---

### Option B: Step by Step

#### Step 1 - Clone the repository

```bash
git clone https://github.com/<your-username>/bookorbit.git
cd bookorbit
```

If you are an external contributor, fork first and clone your fork. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

#### Step 2 - Create your environment file

```bash
cp server/.env.example server/.env
```

Only do this once. If `server/.env` already exists, skip this step. Copying again will overwrite any local changes you have made.

The defaults in `.env.example` work out of the box for local development. You only need to edit this file if you want to change ports, point to a different database, or configure optional features like email.

See the [Key Environment Variables](#key-environment-variables) section for what each variable does.

#### Step 3 - Install dependencies

```bash
pnpm install
```

This installs dependencies for all three workspaces (server, client, packages/types) in one shot.

#### Step 4 - Start PostgreSQL

```bash
docker compose -f docker-compose.dev.yml up -d --wait
```

This starts a PostgreSQL 16 container (with the `pgvector` extension) on port 5432. The `--wait` flag blocks until the database is healthy. Data is persisted in a named Docker volume across restarts.

> **Already have PostgreSQL running?** You can point `DATABASE_URL` in `server/.env` at your existing instance, but you will still need the `uuid-ossp`, `pg_trgm`, and `vector` extensions installed. Using Docker is the easiest path.

#### Step 5 - Apply database migrations

```bash
pnpm run db:migrate
```

This creates all tables and indexes. Migrations are generated by Drizzle Kit and live in `server/src/db/migrations/`.

#### Step 6 - Seed baseline data

```bash
pnpm run db:seed
```

This populates the database with the data required for the app to function (default roles, permissions, initial settings). You only need to run this once.

#### Step 7 - Start the app

```bash
pnpm dev
```

If everything worked, you will see the server, client, and types watcher start up. The app is ready when you see output from all three processes.

---

### Verifying Your Setup

| Check                                    | Expected                                   |
| ---------------------------------------- | ------------------------------------------ |
| Open http://localhost:5173               | BookOrbit login page loads                 |
| Open http://localhost:3000/api/v1/health | Returns `{"status":"ok"}`                  |
| `docker ps`                              | Shows `bookorbit-dev-db` container running |

---

## Running the App

```bash
pnpm dev
```

This starts the server, client, and types watcher concurrently with hot reload.

| Service | URL                       |
| ------- | ------------------------- |
| Client  | http://localhost:5173     |
| API     | http://localhost:3000/api |

If PostgreSQL is not running, start it first with `pnpm run db:up`.

### API Docs

Generated OpenAPI docs are disabled by default. To enable them for local development, set `SWAGGER_ENABLED=true` in `server/.env` or prefix the dev command:

```bash
SWAGGER_ENABLED=true pnpm dev
```

When enabled, open:

| Docs         | URL                                 |
| ------------ | ----------------------------------- |
| Swagger UI   | http://localhost:3000/api/docs      |
| OpenAPI JSON | http://localhost:3000/api/docs-json |

<details>
<summary>Running workspaces separately</summary>

```bash
# Terminal 1: Server
cd server && pnpm start:dev

# Terminal 2: Client
cd client && pnpm dev
```

If you are editing shared types (`packages/types/`), also start the types watcher:

```bash
# Terminal 3: Types (only needed when editing packages/types/)
pnpm --filter @bookorbit/types dev
```

</details>

---

## Key Environment Variables

These are the variables you are most likely to need during development. See `server/.env.example` for the full list with comments.

| Variable          | Purpose                            | Default (dev)                                             |
| ----------------- | ---------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string       | `postgres://bookorbit:bookorbit@localhost:5432/bookorbit` |
| `PORT`            | Server listen port                 | `3000`                                                    |
| `NODE_ENV`        | Runtime mode                       | `development`                                             |
| `JWT_SECRET`      | Signing key for auth tokens        | `change-me-in-production`                                 |
| `APP_DATA_PATH`   | Storage for covers, avatars, cache | `../local/data`                                           |
| `APP_URL`         | Base URL for email links           | `http://localhost:5173`                                   |
| `SWAGGER_ENABLED` | Serve Swagger UI and OpenAPI JSON  | `false`                                                   |

---

## Database

### Schema Organization

Database tables are defined as Drizzle `pgTable()` calls in `server/src/db/schema/`, one file per domain (e.g. `books.ts`, `auth.ts`, `kobo.ts`). All files are re-exported from `server/src/db/schema/index.ts`.

Type inference uses `typeof table.$inferSelect` and `$inferInsert`. Never write manual type aliases for DB rows.

### Common Commands

| Command                                | What it does                                    |
| -------------------------------------- | ----------------------------------------------- |
| `pnpm run db:up`                       | Start PostgreSQL via Docker                     |
| `pnpm run db:migrate`                  | Apply pending migrations                        |
| `cd server && pnpm db:generate <name>` | Generate a migration from schema changes        |
| `pnpm run db:seed`                     | Seed baseline data                              |
| `pnpm run db:reset`                    | Drop everything, re-migrate, re-seed (dev only) |
| `cd server && pnpm db:studio`          | Open Drizzle Studio (visual DB browser)         |

### Making a Schema Change

1. Edit the relevant file in `server/src/db/schema/`.
2. Generate a migration: `cd server && pnpm db:generate describe-your-change`
3. Review the generated SQL in `server/src/db/migrations/`.
4. Apply it: `pnpm run db:migrate`

Never hand-write migration SQL. Always let Drizzle Kit generate it from schema diffs.

### Migration Strategy

**Before production launch (current phase):** We maintain a single baseline migration (`0000_*.sql`). When adding new tables or columns, wipe the migrations folder and regenerate:

```bash
rm -rf server/src/db/migrations
docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d --wait
cd server && pnpm db:generate baseline && pnpm run db:migrate
```

**After production launch:** Never wipe migrations. Every schema change gets its own incremental migration.

### Full Reset

When local migration state is broken or you need a clean slate:

```bash
pnpm run db:reset
```

If that is insufficient (e.g. corrupted Docker volumes), stop the container with `-v` to drop volumes, then start fresh:

```bash
docker compose -f docker-compose.dev.yml down -v
pnpm run db:up
pnpm run db:migrate
pnpm run db:seed
```

---

## Testing

| Command                          | What it runs                     |
| -------------------------------- | -------------------------------- |
| `pnpm run test`                  | Server + client unit tests       |
| `pnpm run test:server`           | Server unit tests only           |
| `pnpm run test:client`           | Client unit tests only           |
| `cd server && pnpm test:watch`   | Server tests in watch mode       |
| `pnpm run e2e:run -- <suite-id>` | Run a single E2E suite           |
| `pnpm run e2e:all`               | Run all E2E suites sequentially  |
| `pnpm run e2e:list`              | List available E2E suite IDs     |
| `pnpm run coverage`              | Unit tests with coverage reports |

Server unit tests use Vitest with `@nestjs/testing`. Client tests use Vitest with `@vue/test-utils` in a jsdom environment. Most E2E suites boot the full app against a dedicated test database; a few smoke-style suites run against a shared E2E database without a reset.

For test architecture, suite details, coverage thresholds, the E2E harness, and examples, see [TESTING.md](TESTING.md).

---

## Code Quality

### Quality Gates

| Command                  | What it checks                               | When to use                  |
| ------------------------ | -------------------------------------------- | ---------------------------- |
| `pnpm run verify:fast`   | Lint + typecheck + tests                     | Quick check while developing |
| `pnpm run verify`        | Lint + typecheck + tests (full)              | Before opening a PR          |
| `pnpm run verify:strict` | Format check + lint + full typecheck + tests | Strictest gate               |

### Individual Checks

| Command                 | What it does                           |
| ----------------------- | -------------------------------------- |
| `pnpm run lint:check`   | ESLint across server + client          |
| `pnpm run lint:fix`     | ESLint auto-fix across server + client |
| `pnpm run typecheck`    | TypeScript type checking               |
| `pnpm run format`       | Prettier format across server + client |
| `pnpm run format:check` | Prettier check (no write)              |

### Git Hooks

Two hooks run automatically via [Husky](https://typicode.github.io/husky/):

- **Pre-commit:** Runs `lint-staged` on staged files. This auto-fixes lint issues and formats code with Prettier. You do not need to format manually before committing.
- **Pre-push:** Runs `pnpm verify:fast`. Your push is blocked if lint, typecheck, or tests fail.

---

## Must-Know Conventions

These are the rules that most commonly cause PR rejections. Following them from the start will save you review cycles.

### Backend

- **One module per feature.** Each domain lives in `server/src/modules/<feature>/` with its own controller, service, module, and `dto/` subfolder.
- **DTOs for all input.** Request bodies are validated via `class-validator` decorators on DTO classes. The global `ValidationPipe` rejects unknown fields.
- **Throw NestJS exceptions.** Use `NotFoundException`, `BadRequestException`, `ForbiddenException`, etc. Never throw raw `Error`.
- **Multi-user ownership.** User-owned data needs a `userId` foreign key. Services must check ownership and throw `ForbiddenException` for non-owners.

### Frontend

- **Composition API only.** Every component uses `<script setup lang="ts">`. Never use the Options API.
- **Bare method references in templates.** Write `@click="handleFoo"`, not `@click="handleFoo()"` or `@click="() => handleFoo()"`. This is enforced by ESLint and will block commits.
- **Composables over stores.** Feature-local state lives in composables (`features/<name>/composables/use*.ts`). Use Pinia only when state genuinely needs to be shared app-wide.
- **Native fetch only.** HTTP calls use the native `fetch` API. No axios or other HTTP clients.

---

## CI/CD Pipeline

### What Runs on Pull Requests

The CI workflow (`.github/workflows/ci.yml`) triggers on every PR to `main`:

1. **PR conventions** - Enforces `BO-<issue-number>-<short-description>` branch names, PR title format, commit-header rules from [COMMIT_GUIDELINES.md](COMMIT_GUIDELINES.md), and a PR-description issue link using GitHub closing keywords (`close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved`). CI also verifies that referenced issue numbers actually exist.
2. **Dependency review** - Checks for supply chain issues in new dependencies.
3. **Change detection** - Determines which workspaces (server/client) have changed files.
4. **Lint** - Runs ESLint and format checks on changed workspaces.
5. **Type check** - Runs TypeScript checking on changed workspaces.
6. **Tests** - Runs unit tests on changed workspaces with coverage.

All jobs are conditional: if you only changed client code, server lint/typecheck/tests are skipped.

### What Runs on Main

The same pipeline plus:

- **Container image build** (`.github/workflows/container-image.yml`) - Builds a Docker image and pushes to GitHub Container Registry.

### Releases

Releases are created manually via `workflow_dispatch` on the `release.yml` workflow. The release workflow:

1. Verifies CI has passed for the current `main` commit.
2. Runs semantic-release to determine the next version from commit history.
3. Creates a Git tag and GitHub Release with auto-generated release notes.
4. Builds, scans, and publishes a Docker image with version and `latest` tags.

On pull requests, CI enforces branch naming (`BO-<issue-number>-<short-description>`), validates PR titles with commitlint (for squash-merge release safety), validates PR commit headers against [COMMIT_GUIDELINES.md](COMMIT_GUIDELINES.md), and requires at least one GitHub closing-keyword issue reference in the PR description (for example: `Closes #123`, `Fixes: #123`, or `RESOLVED owner/repo#123`). It also verifies that the branch issue exists in this repository and that PR description issue references resolve to valid GitHub issues. Only releasable types (`feat`, `fix`, `perf`, `security`, `db`, `style`) trigger version bumps.

Example PR description snippet:

```md
## What does this PR do?

Adds pagination for OPDS search results.

Closes #321
```

For the full release runbook, see [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md).

### E2E in CI

E2E suites run only on nightly scheduled CI builds. Each suite runs in its own job with a dedicated PostgreSQL service container. For on-demand E2E runs, use the manual `.github/workflows/e2e.yml` workflow.

### Reading CI Failures

- **Red lint job** - Run `pnpm run lint:check` locally to see the errors.
- **Red typecheck job** - Run `pnpm run typecheck` locally.
- **Red test job** - Run `pnpm run test` locally. Check the test report artifact for details.
- **Red E2E job** - Run `pnpm run e2e:run -- <suite-id>` locally. Ensure your E2E database is prepared with `pnpm run e2e:db:prepare`.

---

## Troubleshooting

**Migrations fail after pulling new changes**

```bash
pnpm run db:migrate
```

If that fails (e.g. conflicting migration state), do a full reset:

```bash
pnpm run db:reset
```

**Type errors after pulling**

Rebuild dependencies and types:

```bash
pnpm install
```

The shared types package rebuilds automatically during install.

**Pre-push hook is failing**

Run the same command the hook uses to see the full error output:

```bash
pnpm run verify:fast
```

**E2E tests failing locally**

Make sure the E2E database is prepared:

```bash
pnpm run e2e:db:prepare
pnpm run e2e:run -- <suite-id>
```

**Port already in use**

The server defaults to port 3000 (configured via `PORT` in `server/.env`) and the client to 5173 (Vite default). If either is occupied, find the process that owns it and stop it, or change the server port in `server/.env`.

**Hot reload not picking up changes**

Restart the dev server. If you changed `package.json` or installed new dependencies, run `pnpm install` first.

**Docker volumes corrupted**

Last resort. This destroys all local data. Stop the container with `-v` to drop volumes, then rebuild:

```bash
docker compose -f docker-compose.dev.yml down -v
pnpm run db:up
pnpm run db:migrate
pnpm run db:seed
```

---

## Command Reference

All commands are run from the repository root unless noted otherwise.

### Setup

| Command                                         | Description                                          |
| ----------------------------------------------- | ---------------------------------------------------- |
| `pnpm setup`                                    | One-command bootstrap (env, deps, DB, migrate, seed) |
| `pnpm install`                                  | Install all workspace dependencies                   |
| `cd server && pnpm run setup:kobo-cloudscraper` | Setup Python venv for Kobo metadata fetcher          |

### Development

| Command               | Description                                   |
| --------------------- | --------------------------------------------- |
| `pnpm dev`            | Start server + client + types with hot reload |
| `pnpm run dev:server` | Start server only                             |
| `pnpm run dev:client` | Start client only                             |

### Database

| Command                                | Description                              |
| -------------------------------------- | ---------------------------------------- |
| `pnpm run db:up`                       | Start PostgreSQL via Docker              |
| `pnpm run db:migrate`                  | Apply pending migrations                 |
| `cd server && pnpm db:generate <name>` | Generate migration from schema changes   |
| `pnpm run db:seed`                     | Seed baseline data                       |
| `pnpm run db:reset`                    | Drop, re-migrate, and re-seed (dev only) |
| `cd server && pnpm db:studio`          | Open Drizzle Studio (DB browser)         |

### Testing

| Command                          | Description                      |
| -------------------------------- | -------------------------------- |
| `pnpm run test`                  | Run server + client unit tests   |
| `pnpm run test:server`           | Run server unit tests            |
| `pnpm run test:client`           | Run client unit tests            |
| `cd server && pnpm test:watch`   | Server tests in watch mode       |
| `pnpm run coverage`              | Unit tests with coverage reports |
| `pnpm run coverage:server`       | Server coverage only             |
| `pnpm run coverage:client`       | Client coverage only             |
| `pnpm run e2e:run -- <suite-id>` | Run a single E2E suite           |
| `pnpm run e2e:all`               | Run all E2E suites               |
| `pnpm run e2e:list`              | List available suite IDs         |
| `pnpm run e2e:db:prepare`        | Prepare the E2E database         |

### Code Quality

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `pnpm run verify`        | Full quality gate (lint + typecheck + tests) |
| `pnpm run verify:fast`   | Quick quality gate                           |
| `pnpm run verify:strict` | Strictest gate (adds format check)           |
| `pnpm run lint:check`    | ESLint check (server + client)               |
| `pnpm run lint:fix`      | ESLint auto-fix (server + client)            |
| `pnpm run typecheck`     | TypeScript type checking                     |
| `pnpm run format`        | Prettier format (server + client)            |
| `pnpm run format:check`  | Prettier check without writing               |
