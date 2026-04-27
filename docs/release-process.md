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

### PR title format

PR titles must follow the [commit guidelines](../COMMIT_GUIDELINES.md):

```
<type>(<scope>): <summary>
```

The PR title is validated by commitlint in the release workflow. Invalid titles will fail the `Lint PR Title` check.

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

---

## Docker Image Publishing

### Release images

The `release.yml` workflow publishes Docker images after a successful release:

- `ghcr.io/neonsolstice/bookorbit:<X.Y.Z>` - version-specific tag
- `ghcr.io/neonsolstice/bookorbit:latest` - latest stable release

Images are scanned with Trivy before push. If critical or high vulnerabilities are found, the push is blocked.

### Continuous validation images

The `container-image.yml` workflow still runs on CI success (push to `main`) and publishes validation images with branch and SHA tags. These are not release images.

---

## Rollback

### Rolling back to a previous release

To deploy a previous version:

```bash
# In your production docker-compose.yml or .env, set:
APP_IMAGE=ghcr.io/neonsolstice/bookorbit:X.Y.Z
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

- **commitlint**: Validates PR title format (PR only).
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
| `.releaserc.json`               | semantic-release config (plugins, release rules) |
| `commitlint.config.cjs`         | commitlint config (type/scope validation)        |
| `.github/workflows/release.yml` | Release and Docker publish workflow              |
