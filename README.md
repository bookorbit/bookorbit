# ProjectX

[![CI](https://github.com/neonsolstice/projectx/actions/workflows/ci.yml/badge.svg)](https://github.com/neonsolstice/projectx/actions/workflows/ci.yml)

A self-hostable book and library management app with Kobo device support. Organize your epub, pdf, and cbz collections, track reading progress, and sync with your Kobo.

---

## Quick Start

### Prerequisites

| Tool    | Version | Install                                                      |
| ------- | ------- | ------------------------------------------------------------ |
| Node.js | >= 24   | [nodejs.org](https://nodejs.org)                             |
| pnpm    | >= 9    | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker  | latest  | [docker.com](https://www.docker.com/products/docker-desktop) |

### Setup

```bash
git clone <repo-url> projectx
cd projectx
pnpm setup
```

Docker is only used for PostgreSQL. The server and client run directly on your machine.

### Start developing

```bash
pnpm dev
```

This starts the NestJS server and Vue client concurrently:

- **Client:** http://localhost:5173
- **API:** http://localhost:3000/api

If you prefer separate terminals (cleaner logs):

```bash
# Terminal 1
cd server && pnpm start:dev

# Terminal 2
cd client && pnpm dev
```

Both must be running. The client proxies all `/api` and `/socket.io` requests to the server, so API calls will fail if only the client is running.

### First steps after setup

1. **Complete initial setup** - you'll be redirected to `/setup` to create the first administrator account (username, password, name, and email).
2. **Create a library** - open Settings (gear icon) > Libraries > Create Library. Add a folder path pointing to some books on your machine, e.g. any directory containing `.epub`, `.pdf`, or `.cbz` files.
3. **Scan** - the library scans automatically after creation. You should see books appear on the home page once the scan completes.

> **Where does data go?** `APP_DATA_PATH` in `server/.env` defaults to `../local/data` (resolves to `<project-root>/local/data`). This is the app's data directory where extracted cover images and thumbnails are stored (`local/data/covers/`). It is **not** where your book files live - those paths are configured per-library in the UI. The `local/` folder is gitignored.

---

## Project Structure

```
projectx/
├── client/             Vue 3 frontend (Vite + Tailwind CSS v4)
├── server/             NestJS 11 backend (Fastify + Drizzle ORM)
├── packages/
│   └── types/          Shared TypeScript types (@projectx/types)
├── docker/
│   └── postgres/       Postgres init scripts (extensions)
├── local/              Local dev data (covers, docs) - gitignored
├── docker-compose.dev.yml  Dev: runs Postgres only (app runs natively)
├── docker-compose.yml      Prod: app + Postgres
├── .env.example            Template env file for production compose
└── Dockerfile              Production multi-stage build
```

### Monorepo layout

This is a **pnpm workspace**. The three packages are:

- **`server/`** - NestJS API. Modules live in `src/modules/`, one folder per feature. Database schema is in `src/db/schema/`.
- **`client/`** - Vue 3 SPA. Feature code lives in `src/features/`, shared components in `src/components/ui/`.
- **`packages/types/`** - Shared types imported as `@projectx/types` by both server and client. Add any type that crosses the API boundary here.

---

## Common Commands

All commands run from the **repo root** unless noted otherwise.

### Everyday workflow

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| `pnpm setup`         | One-time bootstrap                                 |
| `pnpm dev`           | Daily development                                  |
| `pnpm verify`        | Default local checks before push                   |
| `pnpm quick`         | Faster local checks while coding                   |
| `pnpm verify:strict` | Aspirational strict gate (format + full typecheck) |
| `pnpm guide`         | Print command reference                            |

### Development

| Command                       | Description                          |
| ----------------------------- | ------------------------------------ |
| `pnpm dev`                    | Start server + client (concurrently) |
| `cd server && pnpm start:dev` | Server only (watch mode)             |
| `cd client && pnpm dev`       | Client only (Vite dev server)        |

### Testing

| Command                         | Description                  |
| ------------------------------- | ---------------------------- |
| `pnpm test`                     | Server + client unit tests   |
| `pnpm test:server`              | Server unit tests            |
| `pnpm test:client`              | Client unit tests            |
| `pnpm test:e2e:smoke`           | Server smoke e2e             |
| `pnpm coverage`                 | Coverage for server + client |
| `pnpm --filter server test:e2e` | Server e2e only              |

### Database

| Command                                   | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| `pnpm db:up`                              | Start local Postgres                     |
| `pnpm db:migrate`                         | Apply pending migrations                 |
| `pnpm db:seed`                            | Seed baseline app data                   |
| `pnpm db:reset`                           | Reset schema, migrate, and seed          |
| `pnpm --filter server db:generate <name>` | Generate a migration from schema changes |
| `pnpm --filter server db:studio`          | Open Drizzle Studio (DB browser)         |

### Production operations

| Command                                    | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm prod:up`                             | Start/update production compose stack        |
| `pnpm prod:down`                           | Stop production compose stack                |
| `pnpm db:backup:prod`                      | Create Postgres backup (`local/backups/`)    |
| `pnpm db:restore:prod -- <file.dump>`      | Restore backup into production database      |
| `pnpm db:restore:test:prod -- <file.dump>` | Restore into temp DB to validate backup file |

### Linting & formatting

| Command                                 | Description                                |
| --------------------------------------- | ------------------------------------------ |
| `pnpm format:check`                     | Check formatting                           |
| `pnpm format`                           | Auto-format source files                   |
| `pnpm lint:check`                       | Non-mutating lint checks                   |
| `pnpm lint:fix`                         | Auto-fix lint issues                       |
| `pnpm typecheck`                        | Server typecheck + no-new client TS errors |
| `pnpm typecheck:full`                   | Typecheck server + client (strict)         |
| `pnpm typecheck:client:baseline:update` | Refresh accepted client TS baseline        |

---

## Development Workflow

Once `pnpm dev` is running, here's how the feedback loop works for each type of change:

### Frontend (`client/`)

Save a file → Vite HMR hot-swaps the module → browser updates instantly. No restart needed.

### Backend (`server/`)

Save a file → NestJS watch mode (SWC) recompiles and restarts the server automatically. Takes about a second.

### Shared types (`packages/types/`)

The types package points directly at `.ts` source files. Edit a type → both client and server pick it up on their next rebuild cycle. No build step needed.

### Database schema

Schema changes are the one thing that isn't automatic. See [Database Workflow](#database-workflow) for the generate + migrate steps.

### Environment variables

The `start:dev` script reads `server/.env` once at startup. If you change a value in `.env`, you must restart `pnpm dev` for it to take effect.

### After `git pull`

If other people have pushed changes, you may need to sync dependencies and migrations:

```bash
pnpm install                      # pick up lockfile changes
pnpm db:migrate                   # apply any new migrations
```

### Adding a dependency

Always install into the correct workspace, not the root:

```bash
cd server && pnpm add <pkg>       # backend dependency
cd client && pnpm add <pkg>       # frontend dependency
```

### Adding a new feature

The fastest way to learn the patterns is to follow an existing module:

- **Backend:** Look at `server/src/modules/bookmark/` for a minimal example (controller, service, repository, DTO, module). Copy it, rename, and adapt.
- **Frontend:** Look at `client/src/features/collection/` for a full feature (composables for state/API, components for UI).
- **Shared types:** If the feature adds API request/response shapes, add them in `packages/types/src/` and import via `@projectx/types`.

---

## Environment Variables

Server environment is configured in `server/.env` for local development. Production compose uses the repo-root `.env` created from `.env.example`.

| Variable                  | Default                                                | Description                                                |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `DATABASE_URL`            | `postgres://projectx:projectx@localhost:5432/projectx` | PostgreSQL connection string                               |
| `PORT`                    | `3000`                                                 | Server port                                                |
| `NODE_ENV`                | `development`                                          | Environment mode                                           |
| `JWT_SECRET`              | `change-me-in-production`                              | JWT signing secret                                         |
| `SETUP_BOOTSTRAP_TOKEN`   | (empty)                                                | Required in production for initial `/api/v1/auth/setup`    |
| `APP_DATA_PATH`           | `../local/data`                                        | App data directory for cover images (not where books live) |
| `APP_URL`                 | `http://localhost:5173`                                | Client URL (used in emails)                                |
| `NODE_MAX_OLD_SPACE_SIZE` | `2048`                                                 | Docker Node.js heap limit in MB                            |

## Production Deploy

Production uses the root compose file and env file:

- Compose: `docker-compose.yml`
- Env file: `.env` (from `.env.example`)
- Image source: immutable images built in CI (`.github/workflows/container-image.yml`)

Quick start:

```bash
cp .env.example .env
# edit .env and set APP_IMAGE, secrets, APP_URL, and BOOKS_HOST_PATH
pnpm prod:up
```

For production compose, `BOOKS_HOST_PATH` is the only host folder most users need to choose. It is mounted as `/books` in the container, and library paths created in the UI should point under `/books`.

Generated app data and PostgreSQL live in explicit folders beside the compose file:

```text
./data/app       generated covers, author images, staging files, and Book Bucket uploads
./data/postgres  PostgreSQL data
```

The container starts as root only long enough to create/chown app-managed data paths, then runs the Node process as `PUID:PGID`.

On NAS installs, set `PUID` and `PGID` to the user/group that should own app-generated files:

```bash
id your-media-user
```

Do not add a compose `user:` override unless your platform requires it; that bypasses the startup permission repair.

The app container defaults Node's JavaScript heap limit to 2048 MB. Set `NODE_MAX_OLD_SPACE_SIZE` in `.env` if the host needs a lower or higher limit.

---

## Database Workflow

The database schema is defined in `server/src/db/schema/` using Drizzle ORM. Each domain has its own schema file (e.g. `books.ts`, `libraries.ts`, `auth.ts`).

**Making schema changes:**

1. Edit the relevant file in `server/src/db/schema/`
2. Generate a migration: `pnpm --filter server db:generate describe_your_change`
3. Apply it: `pnpm db:migrate`

Never hand-write migration SQL. Always generate from schema diffs.

### Resetting the database from scratch

```bash
pnpm db:reset
```

---

## Architecture Overview

```
┌──────────────┐       ┌──────────────────────┐       ┌────────────┐
│  Vue 3 SPA   │──────>│  NestJS API (/api)   │──────>│ PostgreSQL │
│  port 5173   │<──────│  port 3000           │<──────│ port 5432  │
└──────────────┘       └──────────────────────┘       └────────────┘
       │                        │
       │  WebSocket             │  Drizzle ORM
       │  (socket.io)           │  (schema in src/db/schema/)
       └────────────────────────┘
```

- **Backend:** NestJS 11 on Fastify. Global prefix `/api`. Auth via JWT (access + refresh tokens in httpOnly cookies). RBAC with permissions system.
- **Frontend:** Vue 3 Composition API (`<script setup>`). Tailwind CSS v4 for styling. Feature-local state in composables, not global stores.
- **Database:** PostgreSQL 16 via Drizzle ORM. Migrations generated by Drizzle Kit.
- **Shared types:** `@projectx/types` package ensures API contracts stay in sync.

---

## Troubleshooting

### Port 5432 already in use

Another PostgreSQL instance is running. Either stop it or change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432" # use 5433 on host
```

Then update `DATABASE_URL` in `server/.env` to use port `5433`.

### Port 3000 or 5173 already in use

Kill the process occupying the port:

```bash
lsof -ti:3000 | xargs kill -9   # server port
lsof -ti:5173 | xargs kill -9   # client port
```

### `pnpm db:migrate` does nothing after a schema change

You need to generate a migration first:

```bash
cd server && pnpm db:generate describe_your_change
cd server && pnpm db:migrate
```

### `pnpm db:generate` fails with a connection error

Drizzle Kit auto-loads `server/.env` for the `DATABASE_URL`. If the file is missing or the URL is wrong, generation fails. Verify `server/.env` exists and that PostgreSQL is running (`docker compose ps`).

The fallback URL in `drizzle.config.ts` uses `postgres:5432` (the Docker service hostname), which only works inside Docker, not from the host machine.

### Docker container won't start

```bash
docker compose down
docker compose up -d --wait
```

If the volume is corrupted, wipe it (destroys all data):

```bash
docker compose down -v
docker compose up -d --wait
cd server && pnpm db:migrate
```

### `EACCES: permission denied, mkdir '/data/covers'`

The default compose uses `./data/app` for generated app data. The container repairs `/data` ownership during startup, then runs as `PUID:PGID`.

If this still happens, make sure the folder mounted at `/data` is writable by `PUID:PGID`. Avoid adding `user:` to the app service, because startup cannot repair ownership when it is forced to start as a non-root user.

### `Cannot find module '@projectx/types'`

The shared types package needs to be built or the workspace link is broken:

```bash
pnpm install
```

### CORS errors in the browser

Make sure you're accessing the client at `http://localhost:5173` (not port 3000). The Vite dev server proxies API requests to the backend automatically.

---

## Further Reading

| Doc                                        | What it covers                                               |
| ------------------------------------------ | ------------------------------------------------------------ |
| [`docs/production.md`](docs/production.md) | Production compose deployment, backups, restore testing      |
| [`server/README.md`](server/README.md)     | Backend module map, DB commands, NestJS conventions          |
| [`client/README.md`](client/README.md)     | Frontend project layout, IDE setup, Vue/Tailwind conventions |
| [`packages/types/`](packages/types/)       | Shared type definitions between server and client            |
