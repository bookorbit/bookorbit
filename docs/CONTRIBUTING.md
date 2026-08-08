# Contributing to BookOrbit

Thanks for your interest in contributing to BookOrbit. Whether you are fixing a typo or building a major feature, this guide walks you through the process from start to finish.

**Companion docs:**

- [DEVELOPMENT.md](DEVELOPMENT.md) - Local setup, architecture, commands, and technical reference.
- [TESTING.md](TESTING.md) - Test architecture, E2E suites, coverage thresholds, and harness details.
- [COMMIT_GUIDELINES.md](COMMIT_GUIDELINES.md) - Commit message format, types, scopes, and examples.
- [LOCALIZATION.md](LOCALIZATION.md) - User-facing copy, ICU messages, Crowdin, and adding languages.

---

## Where to Start

Not sure what to work on? Look for issues tagged with:

- [`good first issue`](../../labels/good%20first%20issue) - Scoped tasks with clear acceptance criteria. Great for your first contribution.
- [`help wanted`](../../labels/help%20wanted) - Larger tasks where maintainer bandwidth is limited.

If nothing there catches your eye, browse the open issues or propose something new.

### Documentation Contributions

Doc improvements are always welcome and have a lighter process:

- No tests required.
- Use a branch name that starts with `BO-<issue-number>-` (e.g. `BO-456-docs-fix-setup-instructions`).
- Focus areas: fixing inaccuracies, improving examples, adding missing guides, clarifying confusing sections.

The rest of this guide still applies (issue first, PR template, etc.), but expect a faster review cycle.

---

## Security Issues

Do **not** open public issues for security vulnerabilities. Use GitHub's [private vulnerability reporting](../../security/advisories/new) instead. See [SECURITY.md](../.github/SECURITY.md) for details.

---

## Contribution Workflow

This is the end-to-end journey from idea to merged PR. Each phase builds on the previous one.

### Phase 1: Find or Create an Issue

> **Issue first, PR second.** Every pull request must link to an approved issue assigned to the
> contributor. PRs without prior approval and assignment will be closed without review.

- Browse [open issues](../../issues) for something you want to tackle.
- If you have a new idea, open one using the [bug report](../../issues/new?template=bug_report.yml) or [feature request](../../issues/new?template=feature_request.yml) template.
- Not sure if your idea fits the roadmap? Ask in a new issue before investing time.

### Phase 2: Get Maintainer Approval

Before writing code, comment on the issue to say that you want to implement it and briefly describe
your proposed approach. Then wait for both:

- A maintainer comment explicitly approving the implementation.
- A maintainer assigning the issue to you.

Do not start implementation or open a pull request, including a draft, until both have happened. A
reaction or lack of a response does not count as approval.

If nobody responds within seven days, leave one polite follow-up comment and @mention the maintainers
or contributors already involved in the issue. People have responsibilities outside the project and
may simply have missed the original notification, so a reminder is welcome. Continue waiting for an
explicit reply before starting implementation or opening a pull request.

This step prevents wasted effort on changes that conflict with the project direction. Small bug fixes
with clear reproduction are usually approved quickly.

### Phase 3: Fork and Clone

[Fork the repository](../../fork), then clone your fork:

```bash
git clone https://github.com/<your-username>/bookorbit.git
cd bookorbit
git remote add upstream https://github.com/bookorbit/bookorbit.git
```

> **Trusted contributors** with direct push access can skip the fork and work on branches in the main repository. The rest of this guide assumes the fork workflow.

### Phase 4: Set Up Your Environment

If this is your first time:

```bash
pnpm setup
```

This handles everything: dependencies, PostgreSQL, migrations, and seed data. See [DEVELOPMENT.md](DEVELOPMENT.md) for prerequisites, manual setup steps, and troubleshooting.

### Phase 5: Create Your Branch

Always branch from the latest `main`:

```bash
git fetch upstream
git checkout -b BO-<issue-number>-<short-description> upstream/main
```

Branch name requirements:

- Start with `BO-<issue-number>-`
- Use lowercase kebab-case for the description suffix
- Example: `BO-123-fix-reader-sync`

### Phase 6: Implement Your Change

Start the dev server and get to work:

```bash
pnpm dev
```

Refer to [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details, project structure, database workflows, and conventions. A few ground rules:

- **One logical change per PR.** Do not bundle a bug fix with a refactor or unrelated cleanup.
- **No unapproved dependencies.** Propose new dependencies in the linked issue first (see [Adding Dependencies](#adding-dependencies)).
- **Keep the scope tight.** If you discover something unrelated that needs fixing, open a separate issue for it.

#### Localizing User-Facing Text

BookOrbit uses Vue I18n, with English as the complete source catalog and Crowdin as the source of truth for every other language.

- Add every new user-facing message, including accessibility labels and transient states, to `client/src/locales/en.json` and reference it through Vue I18n.
- Do not add the key or an English fallback to any non-English catalog. Target catalogs are intentionally sparse, and missing messages fall back to English at runtime.
- Do not create or improve target-language translations in a feature pull request. Translate them in [Crowdin](https://crowdin.com/project/bookorbit); the controlled translation workflow will open a separate PR.
- Run `pnpm --filter client validate:locales` after changing `en.json`.
- Read [LOCALIZATION.md](LOCALIZATION.md) before changing ICU plural structure, changing the meaning of an existing message, or adding a language.

CI rejects edits to existing non-English catalogs in ordinary pull requests. A deliberate new-language setup may add only an empty target catalog until Crowdin export is enabled.

### Phase 7: Write and Run Tests

Testing expectations depend on what you changed:

| Change type             | What is expected                               |
| ----------------------- | ---------------------------------------------- |
| Bug fix                 | Regression test proving the bug is fixed       |
| New backend feature/API | Server unit tests for the new behavior         |
| New frontend logic      | Client unit tests (composables, utilities)     |
| UI-only change          | Screenshots, plus a recording for interactions |
| Refactor                | Existing tests stay green, no new tests needed |

Run the full test suite:

```bash
pnpm test
```

If your change touches an area covered by an existing E2E suite, run it locally before pushing: `pnpm run e2e:run -- <suite-id>`. Use `pnpm run e2e:list` to see available suites.

For E2E tests, suite IDs, coverage thresholds, and the test harness, see [TESTING.md](TESTING.md).

### Phase 8: Verify Code Quality

The project has two automated gates that catch issues before they reach CI:

- **Pre-commit hook** runs `lint-staged` on your staged files (ESLint + Prettier).
- **Pre-push hook** runs `pnpm verify:fast` (lint + typecheck + tests). Your push is blocked if this fails.

Before marking your PR ready for review, run the full quality gate yourself:

```bash
pnpm verify
```

See the [Code Quality](DEVELOPMENT.md#code-quality) section in DEVELOPMENT.md for individual commands.

### Phase 9: Commit Your Work

Follow the format in [COMMIT_GUIDELINES.md](COMMIT_GUIDELINES.md). The short version:

```
<type>(<scope>): <summary>
```

- **Type:** `feat`, `fix`, `db`, `perf`, `refactor`, `style`, `docs`, `test`, `build`, `ci`, `chore`, `security`, `revert`
- **Scope** (optional): `auth`, `books`, `library`, `metadata`, `kobo`, `scanner`, etc.
- **Summary:** Imperative mood, lowercase, no period. Describe what the commit does, not what you did.

Examples: `feat(kobo): add shelf sync endpoint`, `fix(reader): correct page count for multi-volume PDFs`

### Phase 10: Open a Pull Request

Push your branch and open a PR against `main`:

```bash
git push origin BO-123-your-feature-name
```

When creating the PR:

- **Fill out the PR template.** It asks for the linked approval, a summary, the commands you ran with
  their real output, what you did while manually testing, end-to-end evidence, and an authorship note
  covering any AI assistance.
- **Use a Conventional Commit-style PR title** (for example: `fix(reader): correct page count for multi-volume PDFs`).
- **Link your issue** with a GitHub closing keyword in the description (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`) and an issue reference (`#123` or `owner/repo#123`).
  Example:

  ```md
  ## What changed

  Correct page count handling for multi-volume PDFs.

  Fixes: #123
  ```

- **Open as a draft** if the implementation is incomplete after the linked issue has been approved and
  assigned. Use the issue for direction before approval.
- **Attach end-to-end evidence.** Upload a recording showing the changed behavior through the real
  client. Ready-for-review PRs without the required evidence will not be reviewed.
- **Disclose AI usage** if applicable. See [AI_POLICY.md](AI_POLICY.md) for the format and expectations.

### Phase 11: Respond to Review

- Expect feedback within a few days, sometimes sooner.
- Push additional commits to address review comments. Do not force-push during review unless a reviewer asks you to.
- Do not resolve review threads yourself. Let the reviewer confirm the fix.
- If feedback is unclear, ask for clarification in the thread.

### Phase 12: After Merge

Your changes ship in a future release when maintainers cut one. Keep your fork in sync for your next contribution:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

---

## Quick-Reference Checklist

Before marking your PR ready for review, confirm:

- [ ] Linked to an approved issue
- [ ] Branch is up to date with `main`
- [ ] One logical change per PR
- [ ] `pnpm verify` passes locally
- [ ] Tests included per the [testing expectations table](#phase-7-write-and-run-tests)
- [ ] Full-stack behavior manually validated
- [ ] UI changes include screenshots, plus a recording when behavior or interaction changed
- [ ] User-facing text uses keys added only to `client/src/locales/en.json`; non-English catalogs are unchanged
- [ ] PR template fully completed
- [ ] No unintended files (build artifacts, `.env`, personal configs)
- [ ] No unapproved new dependencies

---

## Policies

### Adding Dependencies

Do not add dependencies without prior discussion in the linked issue. If proposing one, document:

- What problem it solves.
- Why existing dependencies or a small custom implementation are insufficient.
- Maintenance status and community activity of the package.

### Breaking Changes and Self-Hosted Upgrades

BookOrbit is self-hosted. Any change that can break existing deployments must include a clear upgrade path before merge.

If your PR introduces a breaking change (schema, API contract, environment variable, config format):

- Call it out explicitly in the PR description.
- Document the required upgrade steps.
- Include Drizzle migrations for schema changes. Never hand-write migration SQL.

### AI-Assisted Contributions

See [AI_POLICY.md](AI_POLICY.md). The short version: disclose all AI usage in your PR description and make sure you understand every line of the diff.

---

## License

By contributing, you agree that your contributions are licensed under the same license as the project (AGPL-3.0).
