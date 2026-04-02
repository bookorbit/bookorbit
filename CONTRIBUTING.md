# Contributing to ProjectX

Thanks for your interest in contributing! Whether you're fixing a bug, suggesting a feature, or improving docs, every contribution is appreciated.

## What is ProjectX?

ProjectX is a self-hostable digital library for managing and reading books and comics, with first-class Kobo device support.

**Tech stack:**

- **Frontend:** Vue 3, TypeScript, Tailwind CSS
- **Backend:** NestJS, Fastify, Drizzle ORM
- **Database:** PostgreSQL
- **Deployment:** Docker

---

## Project Structure

```
projectx/
├── client/              # Vue 3 frontend
├── server/              # NestJS backend
│   └── src/
│       ├── modules/     # Feature modules (one per domain)
│       ├── db/          # Drizzle schema, migrations
│       └── common/      # Guards, filters, decorators
└── packages/
    └── types/           # Shared types between client and server
```

> **Important:** Types shared between the frontend and backend live in `packages/types/` and are imported via the `@projectx/types` alias. Never duplicate shared types in both workspaces. Always add them here.

---

## Before You Start

> **Issue first, PR second.** Every pull request must be linked to an approved issue. If you want to work on something, open an issue and wait for a maintainer to explicitly approve it before writing any code. A thumbs up reaction or a comment saying "go ahead" on the issue counts as approval. PRs submitted without a linked, approved issue will be closed.

This protects your time and ours: it ensures the work is wanted and you're heading in the right direction before investing effort.

To set your PR up for success, make sure:

- It is linked to an approved issue
- It includes proof of manual testing (screenshots, screen recording, or test output)
- It contains a single focused change, no bundled unrelated work
- It is reasonably sized. PRs with 1000+ changed lines are hard to review. Split them up.
- No new dependencies are added without prior discussion

If you're unsure whether something fits the project's direction, open an issue and ask before building it.

---

## Where to Start

Not sure where to begin? Look for issues labeled:

- [`good first issue`](../../labels/good%20first%20issue) - small, well-scoped tasks ideal for newcomers
- [`help wanted`](../../labels/help%20wanted) - tasks where a contribution would be especially welcome

---

## Security Issues

Please do not open public issues for security vulnerabilities. See [SECURITY.md](.github/SECURITY.md) for how to report them privately.

---

## Getting Started

### Fork and Clone

[Fork the repository](../../fork) on GitHub, then clone your fork locally:

```bash
git clone https://github.com/<your-username>/projectx.git
cd projectx
git remote add upstream https://github.com/neonsolstice/projectx.git
```

### Keep Your Fork in Sync

Before starting new work, pull the latest changes from upstream:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

---

## Development Setup

### Prerequisites

- Node.js >= 24
- pnpm >= 9
- Docker

### First-time setup

```bash
docker compose up -d          # start PostgreSQL
cp server/.env.example server/.env
pnpm install
cd server && pnpm db:migrate
```

### Daily workflow

```bash
pnpm dev        # start server + client
pnpm verify     # run all checks before pushing
```

Other useful commands:

```bash
pnpm verify:fast        # lint + typecheck + tests (pre-push gate)
pnpm db:reset           # wipe and reseed local database
pnpm e2e:list           # list available e2e suite ids
```

---

## Branch Naming

Create branches from `main` using these prefixes:

| Prefix      | Use for            | Example                          |
| ----------- | ------------------ | -------------------------------- |
| `feat/`     | New features       | `feat/reading-progress-sync`     |
| `fix/`      | Bug fixes          | `fix/pdf-page-count-off-by-one`  |
| `refactor/` | Code restructuring | `refactor/library-scan-pipeline` |
| `docs/`     | Documentation      | `docs/opds-setup-guide`          |

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:

```
feat(library): add bulk metadata refresh for selected books
fix(cbz): handle archives with no image files gracefully
feat(opds): add pagination support to feed endpoints
fix(stats): reading session duration calculation off after timezone change
chore(deps): upgrade drizzle-orm to 0.31
test(shelf): add coverage for concurrent shelf update race condition
```

---

## Testing Expectations

`pnpm verify` must pass, but that is the minimum, not the goal. Here is what is expected per change type:

| Change type         | Expected tests                                                             |
| ------------------- | -------------------------------------------------------------------------- |
| Bug fix             | A regression test that would have caught the bug                           |
| New backend feature | Unit tests for the service, covering the main logic paths                  |
| New API endpoint    | At minimum, a test for the happy path and error cases                      |
| New composable      | Unit tests covering the reactive logic                                     |
| UI-only change      | Manual testing with screenshot evidence in the PR                          |
| Refactor            | Existing tests must continue to pass. Add none if coverage stays the same. |

AI-generated tests deserve extra scrutiny. A test that always passes regardless of the implementation is worse than no test at all.

---

## Adding Dependencies

Do not add new dependencies without prior discussion in the linked issue. Every new dependency is a security surface, a bundle size cost, and a long-term maintenance burden.

If a dependency is needed, explain in the issue: what it does, why an existing dependency or a small custom implementation won't work, and how actively it is maintained.

---

## Breaking Changes and Self-Hosted Upgrades

ProjectX users upgrade by pulling a new Docker image. A change that breaks an existing deployment without a documented upgrade path will not be merged until that path is clearly defined.

If your PR introduces a breaking change (schema migration, removed API field, changed env var, modified config format):

- Call it out explicitly in the PR description
- Include the upgrade steps a user would need to follow
- For schema changes, make sure a Drizzle migration is included. Never hand-write SQL.

---

## Submitting a Pull Request

Use a **draft PR** early if you want feedback on direction before the work is done. It signals the PR is not ready for review and avoids back-and-forth on a finished implementation that needs to be rethought.

The project has two automatic gates you should be aware of:

- **pre-commit:** runs `lint-staged` on your staged files. ESLint and Prettier are applied automatically. You do not need to format or lint manually before committing.
- **pre-push:** runs `pnpm verify:fast` (lint + typecheck + tests). If this fails, the push is blocked. Fix the errors before pushing.

`pnpm verify:fast` is a fast check but does not include the `app-smoke` e2e suite. Before opening a PR, run the full gate:

```bash
pnpm verify
```

Before marking your PR ready for review:

- [ ] Linked to an approved issue
- [ ] `pnpm verify` passes locally (includes `app-smoke`, stricter than pre-push)
- [ ] You ran the full stack and manually verified the change works
- [ ] UI changes include a screenshot or screen recording
- [ ] Tests are included per the expectations above
- [ ] No new dependencies added without prior discussion
- [ ] Branch is up to date with `main`
- [ ] The PR contains a single logical change

When you open your PR, a template will appear. Fill it out completely.

**Responding to feedback:** Address all review comments before asking for a re-review. Don't just resolve threads without fixing the underlying issue. PRs with no activity for 30 days after a review request will be closed. You are welcome to reopen when ready.

---

## AI-Assisted Contributions

Contributions using AI tools are welcome, but the quality bar is the same as human-written code. **If you ship it, you own it.**

PRs where the contributor clearly never ran the code, didn't test it, or can't explain what it does make review very difficult and will be closed without detailed feedback.

**If you use AI to help write code, you must still:**

- **Run the code yourself.** Start the full stack and manually verify the change works. Trusting AI output without running it is not acceptable.
- **Review every line.** You must be able to explain any part of your change during review. "The AI suggested it" is not an answer.
- **Keep PRs focused.** One feature or fix per PR. Do not submit a dump of everything the AI generated.
- **Scrutinize AI-generated tests.** They often pass trivially without asserting anything meaningful. Tests that don't validate real behavior will be rejected.
- **Clean up.** Remove dead code, placeholder comments, empty catch blocks, and unnecessary boilerplate.

---

## What Happens After Merge

Merged changes ship with the next release. There is no fixed release cadence. Releases happen when enough meaningful changes have accumulated. If your fix is urgent, mention it in the PR and it can be prioritized.

---

## License

By contributing, you agree that your contributions will be licensed under the same license as this project.
