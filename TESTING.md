# Testing Guide

ProjectX has three layers of tests:

- **Server unit tests:** isolated tests for NestJS services, controllers, repositories, and utilities. Dependencies are mocked; no database required.
- **Client unit tests:** tests for Vue composables and pure utility functions using a jsdom environment.
- **End-to-end (E2E) tests:** full-stack tests that boot a real NestJS application and run HTTP requests against a PostgreSQL database.

Each layer has a specific job and its own tooling. Don't cover the same thing at multiple layers.

For testing expectations by change type, see [CONTRIBUTING.md](CONTRIBUTING.md).
For the development setup, see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Quick Reference

| Command                          | What it does                         |
| -------------------------------- | ------------------------------------ |
| `pnpm run test`                  | All unit tests (server + client)     |
| `pnpm run test:server`           | Server unit tests only               |
| `pnpm run test:client`           | Client unit tests only               |
| `cd server && pnpm test:watch`   | Server unit tests in watch mode      |
| `pnpm run coverage`              | Coverage reports for server + client |
| `pnpm run coverage:server`       | Server coverage only                 |
| `pnpm run coverage:client`       | Client coverage only                 |
| `pnpm run e2e:run -- <suite-id>` | Run a specific E2E suite             |
| `pnpm run e2e:all`               | Run all E2E suites sequentially      |
| `pnpm run e2e:list`              | List all available E2E suite IDs     |
| `pnpm run e2e:db:prepare`        | Reset and migrate the E2E database   |

---

## Unit Tests

|            | Server                                                                      | Client                                                                |
| ---------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Config     | `server/vitest.config.ts`                                                   | `client/vitest.config.ts`                                             |
| Test files | `server/src/**/*.test.ts` (e.g. `book.service.ts` → `book.service.test.ts`) | `client/src/**/*.test.ts` (e.g. `useSearch.ts` → `useSearch.test.ts`) |
| Env        | Node                                                                        | jsdom                                                                 |
| Globals    | Enabled (no import needed)                                                  | Disabled (import from `vitest`)                                       |
| Coverage   | 85% statements/lines/functions, 70% branches (CI enforced)                  | 1% (not blocking)                                                     |

Coverage excluded on the server: test files, `*.module.ts`, `main.ts`, `src/db/schema/**`,
type definitions, interfaces, constants, enums, config files, and scripts.

---

## End-to-End Tests

### Architecture

```text
scripts/e2e/
  suite-registry.mjs     <- source of truth: all suite metadata and changedPaths
  run-suite.mjs          <- orchestrator: preps DB if needed, then runs vitest
  select-matrix.mjs      <- CI smart matrix: picks suites based on changed file paths
  list-matrix.mjs        <- full matrix: all suites (used by manual workflow dispatch)
  prepare-db.sh          <- drops, re-creates, and migrates the projectx_e2e schema

server/
  vitest.config.e2e.ts   <- separate vitest config (forks pool, sequential files)
  test/
    e2e.setup.ts         <- global setup: mocks waitForStability
    e2e/
      app-harness.ts     <- shared NestJS bootstrap and DB helpers
      scanner/           <- scanner-specific harness helpers
    *.e2e-spec.ts        <- one spec file per suite (18 total)
```

**Key vitest E2E settings** (`server/vitest.config.e2e.ts`):

- `pool: 'forks'`: each spec file runs in a separate process for full isolation
- `fileParallelism: false`: spec files within a run execute sequentially
- `setupFiles: ['test/e2e.setup.ts']`: runs before every suite; mocks `waitForStability`
- `DATABASE_URL` is always overridden to `E2E_DATABASE_URL` (defaults to `projectx_e2e`), so
  E2E tests never touch the dev database

### DB modes

Every suite runs in one of two modes:

| Mode         | `prepareDedicatedDatabase` | Database used                                          | When to use                                      |
| ------------ | -------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| default-db   | `false`                    | `E2E_DATABASE_URL` with no reset before run            | Fast smoke tests that don't write data           |
| dedicated-db | `true`                     | `projectx_e2e` dropped and re-migrated before each run | Any test that writes data or needs a clean state |

For dedicated-db suites, `run-suite.mjs` automatically runs `pnpm run e2e:db:prepare` before
launching vitest. This drops and re-creates the `projectx_e2e` schema and applies all
migrations fresh.

### Running E2E tests

```bash
# Run a single suite
pnpm run e2e:run -- scanner-scenarios

# Run all suites sequentially
pnpm run e2e:all

# List all registered suite IDs
pnpm run e2e:list

# Filter by test name within a suite
pnpm run e2e:run -- scanner-scenarios --testNamePattern=book-per-folder-flat-root-file

# Use a custom E2E database URL
E2E_DATABASE_URL=postgres://... pnpm run e2e:run -- scanner-scenarios
```

The default E2E database URL is `postgres://projectx:projectx@localhost:5432/projectx_e2e`.
PostgreSQL must be running locally (start it with `pnpm run db:up` if needed).

> **Override the database:** Use `E2E_DATABASE_URL`, not `DATABASE_URL`. The vitest config
> reads `E2E_DATABASE_URL` and injects it as `DATABASE_URL` into test workers; setting
> `DATABASE_URL` directly has no effect.

E2E tests use the same `server/.env` as development. If tests behave differently locally vs CI,
check that your env vars match the values in `server/.env.example`.

### Suite reference

| Suite ID                      | Lane  | DB mode      | Timeout | Description                                                                                                           |
| ----------------------------- | ----- | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `guard-mechanics`             | smoke | default-db   | 30 min  | `@Public` / `@RequirePermission` guard wiring; uses its own minimal NestJS testing module, not the shared app harness |
| `scanner-scenarios`           | full  | dedicated-db | 45 min  | File organization scenario matrix for the library scanner                                                             |
| `scanner-file-operations`     | full  | dedicated-db | 60 min  | File add/remove/rename operations and scanner reconciliation                                                          |
| `auth-session-security`       | full  | dedicated-db | 50 min  | Cookie flags, token rotation, concurrent sessions                                                                     |
| `auth-recovery-oidc-logout`   | full  | dedicated-db | 50 min  | Password reset flow and OIDC logout                                                                                   |
| `book-bucket-ingest-finalize` | full  | dedicated-db | 45 min  | Book Bucket upload ingest and finalize flow                                                                           |
| `metadata-write`              | full  | dedicated-db | 60 min  | Metadata write operations (field updates, bulk edits)                                                                 |
| `metadata-lock`               | full  | dedicated-db | 60 min  | Metadata lock enforcement across operations                                                                           |
| `migration-booklore`          | full  | dedicated-db | 70 min  | Booklore v1 to ProjectX data migration                                                                                |
| `authorization-matrix`        | full  | dedicated-db | 60 min  | Permission enforcement across all protected routes                                                                    |
| `book-api-contract`           | full  | dedicated-db | 60 min  | Book API response shape and field contract                                                                            |
| `app-settings-oidc-contract`  | full  | dedicated-db | 60 min  | App settings and OIDC configuration contract                                                                          |
| `library-admin-workflows`     | full  | dedicated-db | 60 min  | Library create/update/delete admin workflows                                                                          |
| `reader-format-delivery`      | full  | dedicated-db | 60 min  | Book file serving and format delivery                                                                                 |
| `opds-auth-catalog`           | full  | dedicated-db | 45 min  | OPDS feed authentication and catalog structure                                                                        |
| `email-lifecycle`             | full  | dedicated-db | 45 min  | Email provider, template, and send lifecycle                                                                          |
| `reader-state-isolation`      | full  | dedicated-db | 45 min  | Reading progress, bookmarks, and annotations isolated per user                                                        |
| `users-admin-lifecycle`       | full  | dedicated-db | 50 min  | User create/update/delete admin lifecycle                                                                             |

JUnit XML output for each suite is written to `test-results/server/<suite-id>-e2e-junit.xml`.

> **Timeout column** is the GitHub Actions job timeout, not a per-test vitest timeout.
> Individual tests have no configured timeout and use vitest defaults.

**Lanes:** The smoke lane (`guard-mechanics`) always runs on PRs. Full-lane suites run only
when their `changedPaths` list in the registry matches the files changed in the PR. Nightly
scheduled runs and manual dispatches always run all suites.

### App harness

`server/test/e2e/app-harness.ts` is the shared infrastructure used by every E2E suite.

**Bootstrapping:**

```typescript
import {
  createE2EContext,
  closeE2EContext,
  type E2EContext,
} from "./e2e/app-harness";

let ctx: E2EContext;

beforeAll(async () => {
  ctx = await createE2EContext();
});

afterAll(async () => {
  await closeE2EContext(ctx);
});
```

`createE2EContext()` boots the full `AppModule` via `Test.createTestingModule`, applies the
same global pipes and exception filter as production, registers cookie support, and returns:

| Property         | Type                     | What it is                           |
| ---------------- | ------------------------ | ------------------------------------ |
| `ctx.app`        | `NestFastifyApplication` | The running application instance     |
| `ctx.db`         | Drizzle ORM instance     | Connected to the E2E database        |
| `ctx.adminToken` | `string`                 | A valid JWT for the seeded superuser |

`MetadataService` is replaced with a no-op mock by default so E2E tests never make external
metadata provider calls. To customise the mock for a specific suite, pass the result of
`makeMetadataNoopMock()` and configure its `vi.fn()` methods before calling
`createE2EContext()`.

**Making HTTP requests:**

```typescript
const response = await ctx.app.inject({
  method: "GET",
  url: "/api/v1/books/99",
  headers: { authorization: `Bearer ${ctx.adminToken}` },
});

expect(response.statusCode).toBe(200);
const body = response.json() as { id: number; title: string };
```

`app.inject()` is Fastify's built-in injection; no network socket or supertest needed.

**Direct database access:**

```typescript
import { eq } from "drizzle-orm";
import { books } from "../../src/db/schema";

const [book] = await ctx.db.select().from(books).where(eq(books.id, 99));
expect(book.status).toBe("present");
```

**Key helper functions:**

| Function                                            | Returns                          | Purpose                                                                     |
| --------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `seedLibrary(db, input)`                            | `{ libraryId, libraryFolderId }` | Insert a library and folder row directly into the DB                        |
| `triggerLibraryScan(ctx, libraryId)`                | `jobId: number`                  | POST to the scan endpoint                                                   |
| `triggerAndWaitForLibraryScan(ctx, libraryId, ms?)` | `ScanJob`                        | Trigger a scan and poll until complete (default 30s timeout)                |
| `waitForScanCompletion(db, jobId, ms?, pollMs?)`    | `ScanJob`                        | Poll `scanJobs` until `completed` or `failed` (100ms default poll interval) |
| `waitForCondition(check, timeoutMs?, pollMs?)`      | `void`                           | Retry an async assertion until it passes or times out (200ms poll)          |
| `loadLibraryBookState(db, libraryId)`               | `LibraryBookState[]`             | Snapshot all books and files for a library, sorted for comparison           |
| `loadIntegritySnapshot(db)`                         | `IntegritySnapshot`              | Return counts of all orphan rows across relational tables                   |
| `assertNoIntegrityViolations(db)`                   | `void`                           | Throw if any orphan rows are found                                          |
| `makeMetadataNoopMock()`                            | `MetadataNoopMock`               | Return a mock `MetadataService` with all methods resolved to `undefined`    |

Suite-specific helpers extend or re-export from the app harness. See
`server/test/e2e/scanner/scanner-harness.ts` for an example; it re-exports the common
functions and adds `startLibraryWatcher` and `stopLibraryWatcher`.

### Adding tests to an existing suite

1. Open `server/test/<suite-id>.e2e-spec.ts`.
2. Locate the shared `ctx` set up in `beforeAll`/`afterAll`.
3. Add `describe`/`it` blocks using `ctx.app.inject()` for HTTP and `ctx.db` for assertions.
4. Because `fileParallelism: false`, all tests in a suite share the same app instance. Use
   `beforeEach`/`afterEach` to clean up any rows your tests insert to avoid cross-test
   interference.

### Adding a new suite

**Step 1 - Create the spec file**

Create `server/test/<suite-id>.e2e-spec.ts`. Use `createE2EContext`/`closeE2EContext` in
`beforeAll`/`afterAll`. Any existing `*.e2e-spec.ts` is a reference for the standard structure.

**Step 2 - Add suite helpers (optional)**

For fixture builders or harness utilities specific to your suite:

```text
server/test/e2e/<suite-name>/
```

**Step 3 - Register in the suite registry**

Add an entry to `scripts/e2e/suite-registry.mjs`:

```javascript
"my-new-suite": {
  id: "my-new-suite",
  name: "My New Suite",
  timeout: 60,
  lane: "full",
  description: "Short description of what this suite covers",
  vitestTarget: "test/my-new-suite.e2e-spec.ts",
  junitOutput: `${TEST_RESULTS_DIR}/my-new-suite-e2e-junit.xml`,
  prepareDedicatedDatabase: true,   // false only if your suite never writes data
  useDedicatedDatabase: true,
  changedPaths: [
    "server/src/modules/my-feature/**",
    "server/test/my-new-suite.e2e-spec.ts",
    "server/test/e2e/my-suite/**",
    ...SHARED_DB_AND_HELPER_PATHS,
  ],
},
```

Keep `changedPaths` precise. Overly broad patterns will schedule your suite on unrelated PRs.

**Step 4 - CI wiring**

No workflow changes needed. `scripts/e2e/select-matrix.mjs` reads the registry automatically.

---

## Coverage

```bash
pnpm run coverage                    # server + client
pnpm run coverage:server             # text + lcov output to server/coverage/
pnpm run coverage:client             # text + HTML output to client/coverage/
```

Server thresholds (85% statements/lines/functions, 70% branches) are enforced and will fail the
CI test job if dropped below. Client thresholds are 1% by design.

---

## CI Integration

### Unit tests

Unit tests run on every push and PR via `.github/workflows/ci.yml`. The workflow is
change-aware: if only client files changed, only the client test job runs. Each job has a
20-minute timeout. JUnit XML results are published as annotations on the PR or commit, and test
report artifacts are retained for 7 days.

### E2E suites

E2E suites are selected by `scripts/e2e/select-matrix.mjs`:

- **Pull request:** The smoke suite (`guard-mechanics`) always runs. Full-lane suites run only
  when their `changedPaths` match the PR diff.
- **Push to main / nightly / manual dispatch:** All 18 suites run.

Each selected suite runs as its own GitHub Actions job via the reusable
`.github/workflows/e2e-runner.yml` workflow, which spins up a PostgreSQL 16 + pgvector service
container and calls `pnpm run e2e:run -- <suite-id>`.

**Manual full run:** Trigger `.github/workflows/e2e.yml` from the Actions tab. It accepts an
optional `vitest-args` input for filtering by test name.

### Reading CI failures

| Failing job | Local command to reproduce       |
| ----------- | -------------------------------- |
| lint        | `pnpm run lint:check`            |
| typecheck   | `pnpm run typecheck`             |
| tests       | `pnpm run test`                  |
| E2E suite   | `pnpm run e2e:run -- <suite-id>` |

For E2E failures, check the JUnit artifact on the run for the full test report. If the suite
uses a dedicated DB, prepare it first:

```bash
pnpm run e2e:db:prepare && pnpm run e2e:run -- <suite-id>
```
