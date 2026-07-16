## Project

- Book/library management app with Kobo device support.
- pnpm monorepo: `server/` (NestJS), `client/` (Vue 3), `packages/types/` (shared types).
- Requires Node >= 24, pnpm >= 9.

**Local dev setup:**

1. `docker compose up -d` - start PostgreSQL
2. `cp server/.env.example server/.env` - first time only
3. `pnpm install` - install all deps
4. `cd server && pnpm db:migrate` - apply migrations
5. `pnpm dev` - start server + client concurrently

## Scale Expectations

- BookOrbit is designed for large personal libraries: assume tens of thousands of books per user.
- High-volume paths include library browsing, search/filtering, imports, filesystem scans, metadata refresh, cover handling, Kobo sync, and bulk edits.
- Do not implement features that only work for small libraries. Avoid unbounded queries, loading entire libraries into memory, returning full collections to the frontend, N+1 query patterns, or expensive client-side processing over full result sets.
- Use user-scoped queries, pagination or batching, targeted field selection, appropriate indexes, bounded concurrency, and virtualization for long rendered lists where needed.
- Long-running bulk work should have clear progress, useful logs, bounded memory use, and resumable or idempotent behavior where practical.

## Backend Conventions

- NestJS 11 with Fastify (`NestFastifyApplication`). Global API prefix: `/api/v1`.
- Constructor injection via `constructor(private readonly service: SomeService)`. Use `@Inject(DB)` for non-standard providers (e.g., the Drizzle instance).
- Database: PostgreSQL via Drizzle ORM. Use `pgTable()` schema definitions and type inference via `typeof table.$inferSelect` / `$inferInsert` - never write manual type aliases for DB rows.
- Config via `@nestjs/config` with named configs (`registerAs()`). Three configs: `appConfig`, `dbConfig`, `authConfig`. Always inject the typed config, never read `process.env` directly in services.
- Validation: DTOs use `class-validator` decorators. `ValidationPipe` is global with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- Error handling: `GlobalExceptionFilter` is registered globally. Throw standard NestJS `HttpException` subclasses (e.g., `NotFoundException`, `BadRequestException`) - never throw raw `Error`.
- Module structure: one feature = one module under `server/src/modules/`. Each module has `controller`, `service`, `module`, and `dto/` subfolder.
- Shared utilities go in `server/src/common/` (filters, guards, decorators, pipes).
- Testing: Vitest + `@nestjs/testing`. All test files use `.test.ts` extension. Use `Test.createTestingModule()` for unit tests. E2E tests go in `server/test/`. Use `vi.fn()`, `vi.mock()`, `vi.spyOn()` - never `jest.*`.

## Logging Conventions

- Use this message format for service and integration logs:
  `[event] [phase] key=value ... - short message`
- Valid phases are:
  - `[start]`
  - `[end]`
  - `[fail]`
- Do not use dotted phase style like `fetch.start` / `fetch.end` / `fetch.fail`.
- Keep one stable `event` per operation (for example `book.refresh_metadata`, `author.bulk_refresh_metadata`).

When to add start/end/fail logs:

- Non-trivial operations:
  - batch loops
  - external API/provider calls
  - multi-step DB work (fan-out queries, complex writes)
  - file system operations
  - orchestration/background jobs
  - destructive operations (delete/merge/bulk update)

When to avoid start/end logs:

- Chatty hot paths (simple reads, access checks, tiny helper methods)
- very frequent per-item loops unless there is an error
- add fail logs in these paths if needed, and use threshold-based logs for slow reads

Required fields:

- `[start]`: primary IDs + key input flags
- `[end]`: primary IDs + `durationMs` + outcome counters/flags
- `[fail]`: primary IDs + `durationMs` + `errorClass` + `error="<sanitized message>"`

Key rules:

- Keep key order stable: IDs -> inputs -> outcomes/errors
- Keep logs single-line
- Do not log secrets, tokens, raw DTO payloads, or large blobs
- Keep `error` short and sanitized

**Always use `sanitizeLogValue()` from `server/src/common/utils/log-sanitize.utils` for any dynamic value embedded inside a quoted log field (e.g., `error="..."`, `path="..."`, `message="..."`).** Never inline `.replace(/"/g, '\\"')` or similar partial escaping - it misses backslashes and triggers CodeQL `js/incomplete-sanitization` alerts.

Examples:

- `[book.refresh_metadata] [start] bookId=1287 userId=42 preview=false - refresh metadata started`
- `[book.refresh_metadata] [end] bookId=1287 durationMs=914 updatedFields=7 coverDownloaded=true - refresh metadata completed`
- `[book.refresh_metadata] [fail] bookId=1287 durationMs=10023 errorClass=AbortError error="provider timeout" - refresh metadata failed`

## Frontend Conventions

- Vue 3 Composition API with `<script setup lang="ts">` in all components. Never use Options API.
- **All Vue template event handlers must be bare method references: `@click="handleFoo"`.** No inline expressions (`@click="foo()"`) and no inline arrow functions (`@click="() => foo()"`). Always extract a named function. This is enforced by the `vue/v-on-handler-style` ESLint rule and will block commits. The only exception is `v-for` item callbacks where the item must be passed as an argument.
- Props via `defineProps<{ prop: Type }>()`. Emits via `defineEmits<{ ... }>()`.
- State logic in composables (`features/<name>/composables/use*.ts`). Prefer composables over Pinia stores for feature-local state.
- HTTP: use the native `fetch` API directly. No axios or other HTTP client.
- Styling: Tailwind CSS v4 utility classes only. Theme tokens are CSS variables defined in `src/assets/main.css` (OKLch color space). Token names: `--background`, `--foreground`, `--card`, `--primary`, etc. Never hardcode colors.
- Icons: `lucide-vue-next`. No other icon library.
- Routing: Vue Router 5 in `src/router/index.ts`. Use lazy imports for route-level components.
- Testing: Vitest + `@vue/test-utils`. Config in `vitest.config.ts`.
- Responsive design required - support desktop and mobile.

## Shared Types

- `packages/types/` is the source of truth for types shared between server and client. Add types there and import via the `@bookorbit/types` alias. Don't duplicate shared types in both workspaces.

## Database

- PostgreSQL. Schema is split into files under `server/src/db/schema/` and re-exported from `server/src/db/schema/index.ts`. Never edit a single monolithic `schema.ts`.
- Schema changes: edit the relevant file in `server/src/db/schema/`, then run `cd server && pnpm db:generate` to produce a migration, then `pnpm db:migrate` to apply.
- Never hand-write migration SQL. Always use Drizzle Kit to generate from schema diffs.

## Git

- Commit guidelines: [COMMIT_GUIDELINES.md](docs/COMMIT_GUIDELINES.md)
- Branch naming: `BO-<issue-number>-<short-description>` (e.g. `BO-19-fix-mergerfs-inode-overflow`). Always include the issue number when a branch is linked to a GitHub issue.
- **NEVER add a `Co-authored-by` trailer to any commit message.** No `Co-authored-by: Copilot` or any other co-author line. Ever. This is a hard requirement - no exceptions.

## Multi-User Scope

This is a multi-user app. Every feature must be user-scoped by default:

- User-owned data needs a `userId` FK; all queries must filter by it.
- Service methods must check ownership and throw `ForbiddenException` for non-owners (superusers may bypass - see `SmartScopeService` for the pattern).
- Every controller method on user-owned data must inject `@CurrentUser()` and pass it to the service.
- Never write a `findAll()` that returns rows across all users without a filter or an explicit superuser guard.
- Sensitive or destructive actions must be gated by `@RequirePermission(...)` on the backend. Never rely on frontend-only hiding.
- Admin UI sections must check specific permissions via `usePermissions()`, not just `isSuperuser`.

## Feature Checklist

Before marking any feature as done, verify all the following:

**API contract**

- Every frontend `api()` call has a matching backend route (method + path).
- Every field sent in a request body exists in the backend DTO with the correct type. Any extra field causes a 400 with `forbidNonWhitelisted`.
- The backend response shape matches exactly what the frontend destructures. Check field names - never assume.

**Auth & permissions**

- Every destructive or sensitive action is gated by `@RequirePermission(...)` on the backend - never trust frontend-only hiding.
- If an action is restricted to superusers only (e.g. managing other superusers), enforce it server-side with a `ForbiddenException`, and hide it in the UI using `usePermissions()`.
- Non-superuser roles with admin permissions must only see/act on what their permissions cover - never assume `isSuperuser` is the only gate.

**UI access control**

- Admin UI sections are shown based on specific permissions (`hasPermission(...)`) not just `isSuperuser`.
- Buttons/actions that would be rejected by the backend are hidden or disabled in the UI - don't rely on the server error surfacing cleanly.

## Code Quality Standards

Prefer simple feature boundaries and clear ownership. Match existing project patterns before introducing new architecture.

**NestJS**

- Controllers handle HTTP only. Business logic belongs in services.
- Use DTOs for all input/output. Validate at the boundary with pipes.
- Keep database access inside the owning feature boundary. Do not leak ORM queries across modules.
- Cross-cutting concerns go in guards, interceptors, and pipes.

**Vue**

- Components own layout and interaction only - no business logic.
- Reusable reactive logic belongs in composables.
- Templates stay declarative. Complex expressions go in computed properties.

**General**

- No god methods or classes. If it's hard to name, it's doing too much.
- Modules must not import from other modules' internals. Communicate through exported services or shared interfaces only.
- Don't over-engineer. Introduce patterns only when the complexity REALLY justifies it.
- Split code when it improves naming, testability, or ownership.

## Code Style

- Never add unnecessary comments. Only add a comment when the logic is genuinely non-obvious or when it explains a tricky decision that cannot be inferred from the code itself. Do not describe what the code does - only explain why if the reason is not self-evident.
- Always run Prettier before committing (`cd server && npx prettier --write .` and `cd client && npx prettier --write .` as applicable).
- Always run ESLint before committing (`cd server && npx eslint .` and `cd client && npx eslint .` as applicable). Fix any errors before committing.
- Never use em dashes anywhere: UI text, strings, comments, PR descriptions, commit messages, or any other written output. Use a regular hyphen, colon, or rewrite the sentence.

## Verification

- Run the smallest relevant check before marking work done: targeted tests, typecheck, lint, or build as appropriate.
- If a check is skipped, say why in the final response.
- For API changes, verify frontend request shape, backend DTO validation, and response fields together.

## Docker

- Dev: `docker-compose.dev.yml` spins up PostgreSQL only. The app runs natively via `pnpm dev`.
- Production: `docker-compose.yml` is the deployment compose (app + Postgres + migration job). `Dockerfile` is a multi-stage build that builds the client and server into a slim final image.
- Required env vars: `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `BOOKS_PATH`.
