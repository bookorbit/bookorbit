# Architecture Spec: TorBox Download Client for Requests

## Overview

Add TorBox, a cloud (debrid) torrent service, as a torrent download client for the Requests fulfillment pipeline. The adapter contract gains one optional `stage()` method: cloud clients that hold files remotely report completion without a local path, the monitor dispatches a bounded staging job that fetches the completed files from TorBox CDN links into a BookOrbit-controlled containment root, and the existing import then proceeds unchanged. Everything else is additive: a new adapter, a shared-type union entry, a CHECK-constraint migration, and settings UI.

## Decisions

| Decision         | Choice                                                                                                                                                    | Rationale                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Interface change | One optional `stage?(clientKey, config): Promise<StagedDownloadResult>` + exported `stagedDownloadRoot()`                                                 | Additive only, mirrors existing optional `forget?()`; keeps `DownloadState` and DB status enums untouched                                |
| Staging trigger  | Monitor guard: `status` returns `completed` with `contentPath === null` and adapter has `stage` → dispatch staging, do not finalize the attempt that tick | One new branch in `DownloadMonitorService`; next poll (≤5s later) takes the existing completion path once `contentPath` is local         |
| `clientKey`      | Lowercase infohash (consistent with torrent sources)                                                                                                      | Existing dedup index and `normalizeKey` (40-64 hex) work unchanged; adapter resolves hash→`torrent_id` via `mylist`                      |
| Credential kind  | `apiKey` (stored in `credentialsEnc` as today, sent as Bearer)                                                                                            | Kind already exists (SABnzbd); no DTO or schema column changes                                                                           |
| `baseUrl`        | Fixed default `https://api.torbox.app`, prefilled in UI, remains editable                                                                                 | No new plumbing; per-row SSRF guard already applies                                                                                      |
| Staging root     | `join(appDataPath, 'client-downloads')`, per-key dir `client-downloads/torbox/<clientKey>/`                                                               | Sibling of `request-downloads` so direct-download cleanup logic is untouched; importer enforces containment like the `direct_url` branch |
| Reconciliation   | `listOwned()` returns `supported: false`                                                                                                                  | TorBox has no ownership marker/category; adopting a personal debrid account's unrelated torrents would be wrong                          |
| Cancellation     | `remove()` always issues `controltorrent: delete` (permanent) and cancels in-flight staging; `deleteFiles` controls only local staged bytes               | TorBox delete is permanent by API design; local cleanup is what the operator actually controls after import                              |
| Seed goals       | Seed goals accepted but not forwarded in phase 1; `SeedInfo` reports `seeding: true` plus fields TorBox provides                                          | Cloud seeding is TorBox-side; no goal enforcement available reliably - verify against spec, see Open Items                               |
| Scope            | Torrent delivery only                                                                                                                                     | Usenet/webdl families, `checkcached` pre-screening, and post-import TorBox-item cleanup deferred (follow-up issues)                      |

## Project Context

_This section is the single source of project conventions for the Implementer and Code Reviewer._

### Structure

- pnpm monorepo: `server/` (NestJS 11 + Fastify, global prefix `/api/v1`), `client/` (Vue 3 `<script setup lang="ts">`), `packages/types/` (shared source of truth, imported as `@bookorbit/types`).
- Feature module: `server/src/modules/book-request/` with subfolders `download-clients/` (adapters, registry, config service, controller, dto), `fulfillment/` (orchestration, monitor, import, removal), `indexers/`.
- DB schema split under `server/src/db/schema/`; migrations generated by Drizzle Kit (`cd server && pnpm db:generate`, then `pnpm db:migrate`).
- Server tests: Vitest, `.test.ts` next to the file under test, `Test.createTestingModule()`/plain constructors with `vi.fn()`. Client tests: Vitest + `@vue/test-utils`, `.spec.ts` near components.
- Shared module: `client/src/features/settings/DownloadClientsPanel.vue` (settings UI), `client/src/features/book-requests/composables/useDownloadClients.ts`, locale JSON files at `client/src/locales/*.json` (per-language adapter label/description entries).

### Conventions

- **Naming:** PascalCase classes, camelCase methods/fields, kebab-case file names. Adapters named `<client>.adapter.ts` exporting `<Client>Adapter`.
- **HTTP calls:** adapters use `ensureSafeUrl` + `fetchClient` + `readClientJson` + `throwForClientServerError` from `server/src/modules/book-request/download-clients/adapters/client-http.utils.ts`; never raw `fetch` and never `process.env`.
- **Errors:** throw NestJS `HttpException` subclasses (`BadRequestException`, `NotFoundException`); stable error codes in `@bookorbit/types` (e.g. `DOWNLOAD_CLIENT_ERROR_CODES`, `GRAB_FAILURE_CODES`) for form-visible failures.
- **Logging:** `[event] [phase] key=value ... - message` format, phases `[start]`/`[end]`/`[fail]`, dynamic values wrapped with `sanitizeLogValue()`; no secrets in logs.
- **Code style:** no em dashes anywhere, minimal comments (only non-obvious decisions), Prettier + ESLint before commit, no `jest.*` (use `vi.*`), never add `Co-authored-by`.

### Dependencies

- **Runtime:** NestJS 11 + Fastify, Drizzle ORM + PostgreSQL, undici (`FormData`, `fetch`) for client HTTP, chokidar, `@nestjs/schedule` via `@SystemCron`.
- **Build:** pnpm workspaces, `packages/types` version-linked by workspace alias.
- **Infrastructure:** PostgreSQL; TorBox REST API at `https://api.torbox.app` (Bearer API key, JSON envelope `{success, detail, data}`, docs at `https://api.torbox.app/openapi.json`).
- No TorBox SDK: the API is a handful of GET/POST calls; a thin typed client keeps control of fetch-timeouts, SSRF checks, and envelope validation consistent with the other adapters.

### Patterns

- **Adapter registry:** `DOWNLOAD_CLIENT_ADAPTERS` multi-provider; `DownloadClientRegistry.require(type)`. Adapters are stateless-safe except small in-memory caches keyed by client id (see qBittorrent session cache).
- **Durable state in DB, live state polled:** attempt rows in `book_request_downloads` bridge grab → poll → import; clients report generic `DownloadStatus` structs.
- **Bounded background work:** in-memory bounded queues with start-up resilience (`RequestImportQueue` concurrency 1; direct downloads keep in-memory transfer state and recover by re-deriving from disk/client on restart; monitor guards `pollsInFlight`/`lastClientPollAt`).
- **Staging + containment:** direct downloads stage under `directDownloadRoot(appDataPath) = join(appDataPath, 'request-downloads')`; `RequestImportService.resolveLocalPath` asserts containment and hardlinks/copies with `EXDEV` fallback.

## Component Design

### Components / Modules

| Component                            | Input                         | Output                                | Description                                                                                                                                   |
| ------------------------------------ | ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `TorboxApiClient` (new)              | config + method params        | parsed `data` payload                 | Thin typed TorBox REST client: envelope validation (`success`, `data`), Bearer auth, endpoint constants, TorBox error → `BadRequestException` |
| `TorboxAdapter` (new)                | `GrabPayload` / keys / config | `DownloadStatus[]`, staging results   | `DownloadClientAdapter` implementation + in-memory staging job registry                                                                       |
| `DownloadMonitorService` (edit)      | poll tick                     | attempt persistence, staging dispatch | Adds the completed-without-contentPath guard and a bounded staging queue                                                                      |
| `RequestImportService` (edit)        | attempt row                   | resolved local path                   | Adds the staged-client containment branch in `resolveLocalPath`                                                                               |
| `DownloadClientConfigService` (edit) | client id                     | boolean                               | New `stagesLocally(clientId)` lookup via registry                                                                                             |
| `DownloadClientController` (edit)    | HTTP                          | test result                           | New `validate` endpoint used before a row exists                                                                                              |
| `DownloadClientsPanel.vue` (edit)    | form state                    | UI                                    | TorBox form fields + inline validate feedback                                                                                                 |
| `book-request.module.ts` (edit)      | DI                            | adapter registration                  | Adds `TorboxAdapter` to the `DOWNLOAD_CLIENT_ADAPTERS` factory                                                                                |

### Inputs / Outputs

**`DownloadClientAdapter` additions** in `server/src/modules/book-request/download-clients/download-client-adapter.ts`:

```ts
/** Files a cloud client held remotely, now fetched into a root BookOrbit can open. */
export interface StagedDownloadResult {
  /** Local directory holding the finished release, inside stagedDownloadRoot(). */
  contentPath: string;
}
```

```ts
// added to the interface, documented as: cloud clients that do not hold files locally may
// implement this; the monitor calls it when a status reports completion with no contentPath.
stage?(clientKey: string, config: ResolvedClientConfig): Promise<StagedDownloadResult>;
```

```ts
/** Where staging adapters land fetched cloud files; the import containment boundary for them. */
export function stagedDownloadRoot(appDataPath: string): string;
// = join(appDataPath, 'client-downloads')
```

`DownloadStatus.contentPath` doc comment gains one sentence: for a staging adapter this is a BookOrbit-local path, not the client's own namespace.

**`packages/types/src/download-client.ts`** - append to existing constants (no renames, `Record`s stay exhaustive so TypeScript insists on the new entries):

```ts
DOWNLOAD_CLIENT_TYPES: add "torbox"                       // after "sabnzbd"
DOWNLOAD_CLIENT_DELIVERY: torbox: "torrent"
DOWNLOAD_CLIENT_CREDENTIAL_KIND: torbox: "apiKey"
```

**`TorboxApiClient` requests** (validate everything; treat TorBox `detail` as transport text, sanitize before logging):

| Call             | Wire                                                  | Notes                                                                                                                                                                |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createtorrent`  | `POST /v1/api/torrents/createtorrent`                 | JSON `{magnet}` or multipart `file` (`.torrent`); accept `seed time`/`ratio` params only if the OpenAPI spec shows them (Open Item)                                  |
| `mylist`         | `GET /v1/api/torrents/mylist?id?&offset?`             | One call per poll batch, cached listing by default; returns torrents with `id`, `hash`, `name`, `size`, progress/state fields, `files[]` (`file_id`, `name`, `size`) |
| `controltorrent` | `POST /v1/api/torrents/controltorrent`                | `{id, operation: "delete"}` - note: permanent from account                                                                                                           |
| `requestdl`      | `GET /v1/api/torrents/requestdl?torrent_id=&file_id=` | Returns CDN URL (token-carrying); never persisted or logged; fetched fresh per staging attempt                                                                       |
| `userMe`         | `GET /v1/api/user/me`                                 | Used by `test()`                                                                                                                                                     |

Field names must be verified against `https://api.torbox.app/openapi.json` at implementation time (Open Item).

### Validators

- **`ValidateDownloadClientDto`** (new, `dto/download-client.dto.ts`): `adapterType` (`@IsIn(DOWNLOAD_CLIENT_TYPES)`), `baseUrl` (string, max 2048), optional `username`/`password` (max 1024). No persistence.
- **TorBox form validation** (client): API key required for TorBox (`statusCode === 401/403` mapping surfaces as invalid-key feedback); inline validate button described under Entry Points.

### External Boundaries

| Interface                                                         | Implementation               | External System    | Purpose                                                                   |
| ----------------------------------------------------------------- | ---------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `DownloadClientAdapter` (`type: 'torbox'`)                        | `TorboxAdapter`              | TorBox torrent API | Add/track/remove cloud torrents, stage finished files locally             |
| `TorboxApiClient` (internal helper, not exported from the module) | same file family as adapters | TorBox REST v1     | Envelope/auth/error normalization so the adapter reads domain-shaped data |

### Public Entry Points

| Method          | Path / Trigger                                           | Input                       | Output                                                     | Status Codes / Errors                                                                                       |
| --------------- | -------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Inline validate | `POST /api/v1/admin/download-clients/validate`           | `ValidateDownloadClientDto` | `DownloadClientTestResult` (`{success, version?, error?}`) | 200 (result envelope; caller renders valid/invalid), 400 (malformed DTO), 403 (missing `ManageAppSettings`) |
| Existing suite  | `POST/GET/PUT/DELETE /api/v1/admin/download-clients/...` | unchanged                   | unchanged                                                  | unchanged; TorBox rows flow through the same endpoints via `adapterType`                                    |

The validate handler resolves the adapter via the registry, builds a transient `ResolvedClientConfig` (`id: 0`, `category` default, `allowPrivateAddress: false`), calls `adapter.test()`, and returns its result verbatim. It never persists anything and is a plain read of an operator-supplied credential against the chosen adapter base URL; SSRF handling stays inside each adapter's `ensureSafeUrl` usage.

## Package Structure

```
client/src/
└── features/settings/
    ├── DownloadClientsPanel.vue            ← EDIT (torbox fields, validate feedback)
    └── __tests__/DownloadClientsPanel.spec.ts ← EDIT

client/src/locales/*.json                   ← EDIT (adapter label + description keys for all languages)

packages/types/src/
└── download-client.ts                      ← EDIT (type/delivery/credential-kind unions)

server/src/db/schema/
└── download-clients.ts                     ← EDIT (adapter_type CHECK + 'torbox'; schema-matching test follows)
server/src/db/migrations/                    ← NEW migration (pnpm db:generate)

server/src/modules/book-request/
├── book-request.module.ts                  ← EDIT (register TorboxAdapter)
└── download-clients/
    ├── download-client-adapter.ts          ← EDIT (StagedDownloadResult, stage?, stagedDownloadRoot)
    ├── download-client-config.service.ts   ← EDIT (stagesLocally)
    ├── download-clients.schema.test.ts     ← EDIT (assert CHECK matches types)
    ├── download-clients.service.test.ts / config tests as existing patterns require ← EDIT
    ├── download-clients.controller.ts      ← EDIT (validate endpoint)
    ├── download-clients.controller.test.ts ← NEW (or EDIT where suite lives)
    ├── dto/download-client.dto.ts          ← EDIT (ValidateDownloadClientDto)
    └── adapters/
        ├── torbox.api.ts                   ← NEW (TorboxApiClient + envelope types)
        ├── torbox.adapter.ts               ← NEW (TorboxAdapter + staging jobs)
        └── torbox.adapter.test.ts          ← NEW
```

## Data Flow

1. **Grab:** unchanged orchestration. `RequestFulfillmentService.grab()` resolves magnet or `.torrent`, picks a `torbox` client by delivery compatibility, inserts the attempt, calls `TorboxAdapter.add()` (magnet JSON or multipart to `createtorrent`), and stores the lowercase infohash as `clientKey`. Duplicate-add is resolved by looking up the hash in `mylist` and adopting the existing `torrent_id`.
2. **Poll:** `DownloadMonitorService` tick (5s cadence) calls `TorboxAdapter.status(clientKeys)`: one `mylist` fetch, hash-matched, mapped to generic statuses.
3. **Completion handoff:** when TorBox reports the download finished and nothing is staged yet, `status()` returns `state: 'completed'`, `contentPath: null`. The monitor's new guard detects `completed` + null path + `typeof adapter.stage === 'function'`: it does **not** finalize the attempt, instead queues a staging job (global bounded queue, deduped per client id + key). While a job runs, the adapter keeps reporting `downloading` with staged byte counts, so the stall watchdog sees progress.
4. **Staging:** `TorboxAdapter.stage(clientKey)` resolves the fresh `torrent_id` via `mylist`, iterates `files[]`, and per file: `requestdl` → stream to `client-downloads/torbox/<hash>/<sanitized relative name>` → continue. Idempotent: if files already exist with matching sizes they are skipped, so a restart resumes/re-derives rather than re-downloading. When all files are present the job records the directory as the key's `contentPath` and subsequent `status()` returns `completed` with the local path.
5. **Import:** next poll finalizes the attempt (status `completed`, progress 100, `contentPath` = staged dir, `completedAt`), enqueues the import, and `RequestImportService` runs unchanged except that `resolveLocalPath` first asks `DownloadClientConfigService.stagesLocally(downloadClientId)`; when true it asserts containment under `stagedDownloadRoot(appDataPath)` and returns the path; otherwise the existing path-mapping path applies. Archive extraction, unit selection, dock placement, hardlink/copy, verification, and finalization are all untouched.
6. **Cancel/fail:** request removal calls `adapter.remove()` → `controltorrent: delete`, staging job cancelled (if any), staged dir deleted when `deleteFiles` is truthy. Staging failures retry with backoff up to three consecutive failures, then the attempt fails through the existing `failDownload()` flow with the sanitized TorBox/transport message.

## Error Handling

| Error                                                    | Status / Code                                                                                                           | When                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| TorBox 401/403                                           | `test()` returns `{success: false, error: 'TorBox rejected the API key'}`; runtime calls throw `BadRequestException`    | Invalid or missing API key; drives the inline form feedback    |
| TorBox refuses the torrent (e.g. `BOZO_TORRENT`)         | adapter throws `BadRequestException` with sanitized `detail`; grab layer maps to `GRAB_CLIENT_REFUSED`-family           | Malformed magnet/torrent at `add()`                            |
| TorBox 429 / 5xx                                         | `GRAB_CLIENT_UNAVAILABLE` semantics via existing throw helpers; polls degrade gracefully (attempt simply not updated)   | Rate limit (60/h uncached `createtorrent`) or transient outage |
| Staging fetch failure (network, truncated, cap exceeded) | attempt stays `downloading`, backoff retry, 3 strikes → existing `failDownload()` with `errorClass` + sanitized message | CDN hiccup, killed link, disk full                             |
| Staged path outside `stagedDownloadRoot()`               | import refuses via `assertWithinRoot` containment (defense against crafted `file names`)                                | Malicious/oddly-named torrent contents                         |
| Adapter removed mid-staging                              | staging job result discarded when the attempt is no longer in an unsettled status                                       | Operator deletes the TorBox row or the download                |

## Test Strategy

- **`torbox.adapter.test.ts`** (unit, Vitest, mocked `TorboxApiClient`): envelope parsing; add with magnet/file; hash resolution and duplicate adoption; `DownloadStatus` state-mapping table (cloud-complete, downloading, staged, failed); staging job lifecycle: idempotent resumption, partial progress reporting, per-file cap and traversal-sanitization; `remove()` cancels jobs and cleans dirs; `test()` key-validation error mapping.
- **`download-monitor.service.test.ts`** (edit): guard fires only for `completed` + null contentPath + staging-capable adapter; attempt not finalized that tick; dedup of concurrent stage dispatch; retry backoff and `failDownload` after 3 failures.
- **`request-import.service.test.ts`** (edit): staged branch resolves containment under `stagedDownloadRoot()`; out-of-root path refused; direct_url and mapped-client branches unchanged.
- **`download-clients.schema.test.ts`** (edit): CHECK constraint includes `torbox` and still matches `@bookorbit/types`.
- **Controller/DTO test** (new/edited): `validate` endpoint returns adapter result, gated correctly (`Permission.ManageAppSettings`), no persistence.
- **`DownloadClientsPanel.spec.ts`** (edit): TorBox shows API key field, prefilled base URL, no path-mapping section; validate button renders success/error feedback states.

## Open Items for Implementer

1. **Verify TorBox field names against `https://api.torbox.app/openapi.json` before writing the client**: exact torrent list path and response keys (`id`, `hash`, state/progress naming, `files[].file_id/name/size`), `createtorrent` content encoding and whether seed-time/ratio parameters exist. The design assumes commonly documented shapes; adjust the mapping table, not the contracts.
2. **Staged-file cleanup after import:** direct downloads already clean staging once the dock owns the file (`download-removal.service.ts` tests show this). Extend that trigger to staged client dirs (`client-downloads/...`) once the attempt reaches `imported`/`needs_review`, so disk use stays bounded; keep the removal event-tolerant (files may already be gone).
3. **Locale files:** add adapter label/description keys to all `client/src/locales/*.json`, matching an existing adapter's key layout exactly (values may be English where no translator input exists, but the keys must exist everywhere the types are referenced).
4. **`SeedInfo` fields:** map TorBox reported seeding fields where the API provides them; otherwise `seeding: true` with `null` values is acceptable.
5. **Prefer reusing `client-http.utils` helpers** over new fetch plumbing; keep the API key out of URLs/logs (Bearer header; requestdl token URLs are constructed, fetched, and discarded, never stored).
