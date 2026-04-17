# Commit Message Guidelines

Every commit tells a story. A well-written commit message makes it easy to understand why a change was made, trace regressions, and produce a meaningful changelog. These guidelines define the format for all commits to this repository.

## Format

```
<type>(<scope>): <summary>

[body]

[footer]
```

The **header** is required on every commit and must follow the format described below.

The **body** is required on all commits except `docs`. When present, it must be at least 20 characters and written in imperative mood.

The **footer** is optional. Use it to reference issues, close PRs, or document breaking changes.

---

## Header

```
<type>(<scope>): <summary>
  │       │             │
  │       │             └─ imperative mood, lowercase, no period at the end
  │       │
  │       └─ Scope (optional): auth|books|library|metadata|kobo|opds|reader|
  │                             collections|annotations|authors|series|cover|
  │                             users|stats|notifications|settings|scanner|
  │                             email|audit|lens|types|docker|deps|server|client
  │
  └─ Type: feat|fix|db|perf|refactor|style|docs|test|build|ci|chore|security|revert
```

The `<type>` and `<summary>` fields are required. The `(<scope>)` field is optional.

### Type

The type signals the intent of the change at a glance.

| Type       | When to use                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `feat`     | Introduces a new feature or user-visible capability                                                      |
| `fix`      | Patches a bug in existing behavior                                                                       |
| `db`       | Adds or modifies a Drizzle schema, generates a migration, or changes seed data                           |
| `perf`     | Improves performance without changing observable behavior                                                |
| `refactor` | Restructures code without fixing bugs or adding features                                                 |
| `style`    | Visual/CSS-only changes: Tailwind tweaks, spacing, color token adjustments                               |
| `docs`     | Documentation changes only                                                                               |
| `test`     | Adds or corrects tests without touching production code                                                  |
| `build`    | Changes to the build system, tooling config, or external dependencies (Dockerfile, tsconfig, pnpm)       |
| `ci`       | CI/CD pipeline changes - GitHub Actions workflows and scripts                                            |
| `chore`    | Routine maintenance that doesn't fit any other category                                                  |
| `security` | Addresses a security vulnerability; preferred over `fix` so security patches are identifiable in history |
| `revert`   | Reverts a previous commit - the body must reference the reverted SHA and explain why                     |

> If a change genuinely spans multiple types (for example, it adds a feature and fixes a bug), split it into two commits. If that isn't practical, use the type that best represents the dominant intent.

### Scope

Scope is optional but strongly encouraged. It narrows the type to the affected area of the codebase, making the log significantly more readable.

Use one scope from the table below. If a change affects multiple areas, use the most dominant one.

| Scope           | What it covers                                                |
| --------------- | ------------------------------------------------------------- |
| `auth`          | Authentication, authorization, JWT, OIDC, sessions            |
| `library`       | Library management, file system scanning                      |
| `books`         | Book data, CRUD, book-level state                             |
| `authors`       | Author data and management                                    |
| `series`        | Book series grouping and management                           |
| `cover`         | Book cover image storage, retrieval, and optimization         |
| `metadata`      | Metadata providers, fetch logic, quality scoring, preferences |
| `kobo`          | Kobo device sync and integration                              |
| `opds`          | OPDS catalog endpoints                                        |
| `reader`        | In-app reader, reading position, reader preferences           |
| `collections`   | Collections and shelf management                              |
| `annotations`   | Highlights, bookmarks, notes                                  |
| `users`         | User management, profiles, roles                              |
| `stats`         | Reading sessions, statistics, progress tracking               |
| `notifications` | In-app and email notifications                                |
| `settings`      | Application settings and configuration                        |
| `scanner`       | File scanner and upload pipeline                              |
| `email`         | Email providers, templates, and send preferences              |
| `audit`         | Audit logging and event tracking                              |
| `lens`          | Custom lenses and collection views                            |
| `types`         | Shared types in `packages/types/`                             |
| `docker`        | Dockerfile and Docker Compose files                           |
| `deps`          | Dependency upgrades (pair with `build` or `chore`)            |
| `server`        | Backend-wide changes with no single-module scope              |
| `client`        | Frontend-wide changes with no single-module scope             |

### Summary

The summary is a short, imperative description of what the commit does.

Rules:

- Use the imperative mood: "add", "fix", "remove" (not "added" or "adds")
- Start with a lowercase letter
- No period at the end
- Keep it under 72 characters
- Describe **what** the commit does, not **why**; that belongs in the body

---

## Body

Write a body when the **why** behind the change isn't obvious from the header alone.

When to write a body:

- The motivation isn't clear from the summary
- The change has side effects, tradeoffs, or gotchas worth calling out
- You're reverting a commit - reference the SHA and explain the reason
- The approach taken deserves a brief explanation

Format:

- Separate from the header with a blank line
- Use the imperative mood, consistent with the summary
- Wrap lines at ~100 characters
- Explain **why** this change exists, not **what** changed; the diff already shows that

---

## Footer

Use the footer to link related issues or PRs, or to announce breaking changes.

### Linking issues and PRs

```
Fixes #123
Closes #456
Ref #789
```

`Fixes` and `Closes` automatically close the linked issue when the PR is merged. Use `Ref` for a related issue that should stay open.

### Breaking changes

If the commit introduces a breaking change, open the footer with `BREAKING CHANGE:` followed by a brief summary, a blank line, and clear migration instructions.

```
BREAKING CHANGE: rename BOOKS_PATH env var to LIBRARY_PATH

Update your .env or Docker environment to use LIBRARY_PATH instead.
The old name is no longer recognized and the app will not start without it.
```

Breaking changes must also be explicitly called out in the PR description, including the upgrade steps a user would need to follow.

---

## Examples

### `feat`

```
feat(kobo): sync reading position on device reconnect
```

```
feat(opds): add pagination to catalog feed endpoints

The OPDS feed now supports ?page= and ?limit= query params.
Default page size is 20. Clients that don't send pagination params
get the same behavior as before.

Closes #301
```

### `fix`

```
fix(reader): epub chapter navigation skips last page
```

```
fix(stats): reading session duration wrong after timezone change

Duration was computed using local time offsets rather than UTC,
causing sessions that crossed a DST boundary to report incorrect
elapsed time.

Fixes #412
```

### `db`

```
db(books): add language column to books table
```

```
db(users): add user_preferences table for per-user app settings

Generates a migration. Existing users get default values on deploy.
```

### `perf`

```
perf(library): avoid redundant file stat calls during rescan
```

### `refactor`

```
refactor(metadata): extract provider selection into its own service
```

### `style`

```
style(reader): tighten chapter list spacing in sidebar
```

### `docs`

```
docs: add Kobo device setup guide to README
```

### `test`

```
test(collections): cover concurrent shelf update race condition
```

### `build`

```
build(docker): switch to slim node base image in final stage
```

### `ci`

```
ci: add e2e smoke suite to pull request workflow
```

### `chore`

```
chore(deps): upgrade drizzle-orm to 0.38
```

### `security`

```
security(auth): reject tokens signed with legacy algorithm

Previous tokens signed with HS256 were still accepted after the
migration to RS256. This change enforces RS256-only validation.

BREAKING CHANGE: all existing sessions will be invalidated on deploy.
Users will need to log in again.
```

### `revert`

```
revert: revert "feat(kobo): sync reading position on device reconnect"

Reverts commit a1b2c3d.

Broke sync for devices running firmware < 4.32. Reverting until
a compatibility shim is in place.
```
