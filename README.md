<div align="center">

<!-- Replace this with your logo once available -->
<img src="docs/logo.png" alt="BookOrbit" width="120" height="120" />

# BookOrbit

A self-hosted library management and reading platform for epub, pdf, audiobooks, and comics.

[![CI](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml/badge.svg)](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml)
[![Release](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml/badge.svg)](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/bookorbit/bookorbit?label=latest)](https://github.com/bookorbit/bookorbit/releases)
[![Commits/month](https://img.shields.io/github/commit-activity/m/bookorbit/bookorbit?label=commits%2Fmonth)](https://github.com/bookorbit/bookorbit/commits/main)
[![Stars](https://img.shields.io/github/stars/bookorbit/bookorbit?style=flat)](https://github.com/bookorbit/bookorbit/stargazers)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Container image](https://img.shields.io/badge/ghcr.io-bookorbit%2Fbookorbit-informational?logo=docker&logoColor=white)](https://github.com/bookorbit/bookorbit/pkgs/container/bookorbit)

**[Documentation](https://bookorbit.app) · [Live Demo](https://demo.bookorbit.app) · [Report a Bug](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml) · [Request a Feature](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml)**

</div>

---

![BookOrbit dashboard showing reading stats, widgets, and book shelves](https://bookorbit.app/images/home/dashboard-overview.webp)

---

## About

BookOrbit is a self-hosted book and library manager. Deploy it once on your own server and get a full reading platform: built-in readers, rich metadata, reading statistics, device sync, and multi-user support - all running on your hardware.

No subscription. No third-party account. No data leaving your server.

---

## Live Demo

Try BookOrbit without installing anything. The demo is pre-loaded with a sample library and resets automatically.

**[Open demo](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)** - no account needed, click the link to log in automatically.

---

## Features

- **4 built-in readers** - eBook (EPUB, KEPUB, MOBI, AZW3, FB2), PDF, Comics (CBZ, CBR, CB7), Audiobook (M4B, MP3, FLAC, and more)
- **Multiple libraries** with independent scan rules, format priorities, and metadata configuration
- **Collections and Smart Scopes** - curated lists and saved filters that live in your sidebar
- **Metadata from 9 providers** - Google Books, Goodreads, Hardcover, Amazon, Audible, ComicVine, and more; with field-level rules and confidence scoring
- **Reading statistics** - daily time, heatmap, streaks, pace, goal tracking, and library health
- **Kobo sync** - sideload books and sync reading position over the local network
- **OPDS, email delivery, and Book Dock** for getting books in from anywhere
- **Multi-user** with per-user permissions, isolated reading data, and OIDC/SSO support

---

## Setup

See the **[Installation guide](https://bookorbit.app/installation.html)** for Docker setup, NAS installs, environment variables, and upgrade instructions.

---

## Documentation

Full documentation is at **[bookorbit.app](https://bookorbit.app)**.

> [What is BookOrbit?](https://bookorbit.app/what-is-bookorbit.html) &nbsp;·&nbsp; [Installation](https://bookorbit.app/installation.html) &nbsp;·&nbsp; [Creating a Library](https://bookorbit.app/creating-a-library.html) &nbsp;·&nbsp; [Metadata](https://bookorbit.app/metadata.html) &nbsp;·&nbsp; [Kobo Sync](https://bookorbit.app/kobo.html) &nbsp;·&nbsp; [Users & Permissions](https://bookorbit.app/users.html)

---

## Developing

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for local setup, architecture, project structure, database workflow, and commands. See **[TESTING.md](TESTING.md)** for test suites, coverage, and E2E details.

---

## Contributing

Contributions are welcome. For the full contribution workflow (branch naming, test expectations, PR checklist, commit format), see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

To report a security vulnerability, use [GitHub's private vulnerability reporting](https://github.com/bookorbit/bookorbit/security/advisories/new) - do not open a public issue.

---

## Support

- **Questions and discussion:** [GitHub Discussions](https://github.com/bookorbit/bookorbit/discussions)
- **Bug reports:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml)
- **Feature requests:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml)

---

## License

BookOrbit is licensed under the **[GNU Affero General Public License v3.0](LICENSE)**.
