# Release Process

This document covers how releases are created, what triggers Docker image publishing, and how to roll back if needed.

---

## Overview

BookOrbit uses [semantic-release](https://github.com/semantic-release/semantic-release) for automated versioning and GitHub Release creation. Releases are triggered manually via `workflow_dispatch` and produce:

- A Git tag (`vX.Y.Z`)
- A GitHub Release with auto-generated release notes
- A Docker image pushed to GHCR (`X.Y.Z` + `latest`)

---

## PR Requirements

### Squash merge required

All PRs to `main` must use **squash merge**. The squash commit message becomes the commit that semantic-release analyzes for version bumps.

### PR title, commit message, and issue link format

PR titles and all commits in a PR must follow the [commit guidelines](COMMIT_GUIDELINES.md):

```
<type>(<scope>): <summary>
```

Why PR title is required: with squash merges, the final commit analyzed by semantic-release is based on the PR title.

Validation in CI and release checks:

- PR branch name must follow `BO-123-fix-reader-pagination`
- PR title must match commitlint rules
  - Example: `fix(reader): reduce rerendering in chapter list`
- PR commit headers must match commitlint rules
- PR description must include at least one GitHub closing-keyword issue reference:
  - `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`
  - Examples: `Closes #123`, `Fixes: #123`, `RESOLVED owner/repo#123`
- Branch issue number must exist in this repository
- PR description issue references must resolve to valid GitHub issues (same repo or `owner/repo#issue`)

Examples:

- Valid:

```md
## What does this PR do?

Improve reader performance when opening large EPUB files.

Fixes #145
```

- Invalid (fails lint):

```md
## What does this PR do?

Improve reader performance when opening large EPUB files.

fixes issue 145
```

### Types that trigger releases

| Type       | Release | Notes                    |
| ---------- | ------- | ------------------------ |
| `feat`     | minor   | New features             |
| `fix`      | patch   | Bug fixes                |
| `perf`     | patch   | Performance improvements |
| `security` | patch   | Security patches         |
| `db`       | patch   | Database/schema changes  |
| `style`    | patch   | Visual/CSS changes       |
| `revert`   | none    | No release               |
| `refactor` | none    | No release               |
| `docs`     | none    | No release               |
| `test`     | none    | No release               |
| `build`    | none    | No release               |
| `ci`       | none    | No release               |
| `chore`    | none    | No release               |

Breaking changes (`BREAKING CHANGE:` in footer) always trigger a **major** release regardless of type.

---

## Manual Release Runbook

Releases are triggered manually from the GitHub Actions UI.

### Prerequisites

1. All changes are merged to `main`.
2. CI has passed for the latest commit on `main`.

### Steps

1. Go to **Actions** > **Release** workflow.
2. Click **Run workflow**.
3. Select `main` branch.
4. Click **Run workflow**.

The workflow will:

1. Verify the dispatch is from `main`.
2. Verify CI has passed for the current commit.
3. Run semantic-release to determine the next version.
4. Create a Git tag and GitHub Release with release notes.
5. Build, scan, and push the Docker image (if a new version was published).

### No release produced

If all commits since the last release are non-releasable types (`chore`, `docs`, `test`, `build`, `ci`, `refactor`), semantic-release will skip the release. The Docker publish job will also be skipped.

### Tag created but no Docker image

If the release job stops after semantic-release has pushed the tag (for example a timeout while it comments on released issues), re-running the workflow does not help: semantic-release finds the tag, publishes nothing, and the Docker job is skipped again. Instead, run the workflow from `main` with the **tag** input set to the existing tag, for example `v3.10.0`. This skips semantic-release, checks that CI passed and the SHA image exists for the tagged commit, and builds and pushes the versioned and `latest` images from that tag. Only the newest release tag is accepted, so `latest` never moves backwards.

### Authoring the "What's New" highlights

semantic-release creates the GitHub release as a **draft** with a `## Highlights` scaffold (added by `release.config.js`) that lists this release's `feat` commits as candidate highlights. Open the draft, curate those candidates into user-facing highlight bullets (with optional icons and dragged-in media), validate with `cd server && pnpm whats-new:check <tag>`, then click **Publish release**. The highlights power the in-app "What's New" popup and the `/whats-new` archive; the draft stays hidden in the app until you publish (even though the `:latest` Docker image is pushed beforehand).

Full step-by-step walkthrough, format reference, and pre-publish checklist: [docs/whats-new-authoring-guide.md](whats-new-authoring-guide.md).

---

## Docker Image Publishing

### Release images

The `release.yml` workflow publishes Docker images after a successful release:

- `ghcr.io/bookorbit/bookorbit:<X.Y.Z>` - version-specific tag
- `ghcr.io/bookorbit/bookorbit:latest` - latest stable release

Images are scanned with Trivy before push. If critical or high vulnerabilities are found, the push is blocked.

### Continuous validation images

The `container-image.yml` workflow still runs on CI success (push to `main`) and publishes validation images with branch and SHA tags. These are not release images.

---

## Rollback

### Rolling back to a previous release

To deploy a previous version:

```bash
# In your production docker-compose.yml or .env, set:
APP_IMAGE=ghcr.io/bookorbit/bookorbit:X.Y.Z
```

Replace `X.Y.Z` with the version you want to roll back to, then redeploy:

```bash
pnpm prod:down
pnpm prod:up
```

### Deleting a bad release tag

If a release was created in error and needs to be removed:

```bash
# Delete tag locally and remotely
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

Then delete the corresponding GitHub Release from the Releases page.

---

## Release Workflow Architecture

The `release.yml` workflow has four jobs:

```
┌──────────────┐     ┌──────────────────┐
│  commitlint  │     │ release-dry-run  │    (PR only)
└──────────────┘     └──────────────────┘

┌──────────────┐     ┌──────────────────┐
│   release    │────>│  docker-publish  │    (workflow_dispatch only)
└──────────────┘     └──────────────────┘
```

- **commitlint**: Validates branch naming, PR title, commit headers, and PR description issue-link and issue-existence rules (PR only).
- **release-dry-run**: Runs semantic-release in dry-run mode to validate config (PR only).
- **release**: Creates the actual release (manual dispatch only). Outputs `published`, `version`, and `tag`.
- **docker-publish**: Builds and pushes Docker image (only when a release was published).

### Concurrency

- PR checks cancel older runs for the same PR.
- Manual release runs are serialized and never canceled mid-flight.
- PR checks and manual releases do not block each other.

---

## Configuration Files

| File                            | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `release.config.js`             | semantic-release config (plugins, release rules) |
| `commitlint.config.cjs`         | commitlint config (type/scope validation)        |
| `.github/workflows/release.yml` | Release and Docker publish workflow              |
