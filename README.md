<div align="center">

# BookOrbit

A self-hosted library management and reading platform for ebooks, PDFs, audiobooks, and comics.

[![Latest release](https://img.shields.io/github/v/release/bookorbit/bookorbit?label=latest&style=flat-square)](https://github.com/bookorbit/bookorbit/releases)
[![Stars](https://img.shields.io/github/stars/bookorbit/bookorbit?style=flat-square&color=FFC72C)](https://github.com/bookorbit/bookorbit/stargazers)
[![CI](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml/badge.svg)](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml)
[![Release](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml/badge.svg)](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml)
[![Server Coverage](https://codecov.io/gh/bookorbit/bookorbit/graph/badge.svg?token=F6TADEFCUV&flag=server)](https://codecov.io/gh/bookorbit/bookorbit)
[![Crowdin](https://badges.crowdin.net/bookorbit/localized.svg)](https://crowdin.com/project/bookorbit)

[![Website](https://img.shields.io/badge/Website-bookorbit.app-blue?style=flat-square&logo=googlechrome&logoColor=white&color=4169E1)](https://bookorbit.app)
[![Demo](https://img.shields.io/badge/Demo-live-brightgreen?style=flat-square&logo=rocket&logoColor=white&color=40a829)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)
[![GHCR Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fbookorbit%2Fbookorbit%2Fbookorbit&query=downloadCount&label=Docker%20Pulls&logo=docker&style=flat-square&color=2496ed)](https://github.com/bookorbit/bookorbit/pkgs/container/bookorbit)
[![Contributing](https://img.shields.io/badge/Contributing-guide-orange?style=flat-square&logo=handshake&logoColor=white)](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square&color=B461B3)](LICENSE)

<!--
[![GHCR](https://img.shields.io/badge/GHCR-bookorbit%2Fbookorbit-blue?style=flat-square&logo=docker&logoColor=white)](https://github.com/bookorbit/bookorbit/pkgs/container/bookorbit)
[Website](https://bookorbit.app) · [Demo](https://demo.bookorbit.app) · [Discussions](https://github.com/bookorbit/bookorbit/discussions) · [Contributing](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md) · [Changelog](https://github.com/bookorbit/bookorbit/releases)
-->

</div>

---

![BookOrbit dashboard showing reading stats, widgets, and book shelves](https://bookorbit.app/images/home/dashboard-overview.webp)

## What is BookOrbit?

**[BookOrbit](https://bookorbit.app)** is a self-hosted digital library and reading platform. Organize and read your books, sync progress and annotations seamlessly across Kobo, KOReader, and the web reader, enrich your collection with metadata from multiple providers, and push reading data to Hardcover automatically. Supports multiple users with OIDC/SSO, detailed reading statistics, OPDS, customizable dashboard widgets, Send-to-Kindle delivery, and Smart Scopes - all running on infrastructure you control.

[![Visit Website](https://img.shields.io/badge/Visit%20Website-bookorbit.app-4169E1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://bookorbit.app)

---

## Live Demo

Want to try BookOrbit before installing? Explore the live instance instantly: no account required!

[![Launch Live Demo](https://img.shields.io/badge/Launch%20Live%20Demo-2ea44f?style=for-the-badge&logo=rocket&logoColor=white)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)

_Experience the interface, built-in readers, and dashboard first-hand._

> **Note:** The demo includes a sample library of public domain books. Some administrative features are limited in the public demo. Self-hosting BookOrbit provides the full experience.

---

## Features

### Reading Experience & Sync

- **Built-in Web Readers**: Native support for eBooks (EPUB, MOBI, AZW3), PDFs, Comics (CBZ, CBR), and Audiobooks (M4B, MP3) with no extra plugins required.
- **Three-Way Sync (Kobo + KOReader + BookOrbit)**: Progress and annotations flow bidirectionally between Kobo devices, KOReader, and the BookOrbit web reader. Pick up on any surface where you left off on another - including highlights and deletes.
- **KOReader Plugin**: Native on-device catalog browser with search, download, and status/rating management, alongside full progress and annotation sync.
- **Annotations & Highlights**: Highlights from the web reader, KOReader, and Kobo merge into a unified searchable hub - filterable by color, style, and source, exportable as Markdown, CSV, or JSON.
- **Hardcover Sync**: Automatically pushes status, progress, reading dates, and ratings to Hardcover on configurable triggers. Pull read history back from Hardcover to backfill blank BookOrbit entries.
- **Readwise Sync**: Automatically pushes new highlights and notes to Readwise as you create them, from both the web reader and synced devices, with book covers matched by ISBN.
- **Achievements & Reading Goals**: Yearly goals, daily streaks, monthly challenges, and 50+ achievements across five categories. Reading DNA profiles your reading style from your actual session history.
- **Reading Statistics**: Track your daily reading time, view heatmaps, maintain streaks, and monitor library health.

### Library Management

- **Multiple Libraries**: Isolate content with per-library folders, custom scan rules, and format priorities.
- **Rich Metadata Providers**: Fetch robust metadata from Google Books, Amazon, Goodreads, Open Library, Audible, ComicVine, and more.
- **Smart Scopes & Collections**: Organize your collection using curated lists and dynamic, rule-based saved filters.

### Platform & Delivery

- **Multi-User & SSO**: Granular per-user permissions and isolated reading data, with native support for Authentik, Keycloak, and Authelia via OIDC.
- **Content Delivery**: OPDS support for compatible apps, Send-to-Kindle via email, and browser drag-and-drop uploads.
- **Automated Ingestion**: Configure a Book Dock drop folder for hands-free importing.

---

## Quick Start (Docker)

```bash
mkdir bookorbit && cd bookorbit
mkdir -p books data/app data/postgres
curl -fsSLo .env https://raw.githubusercontent.com/bookorbit/bookorbit/main/.env.example
curl -fsSLo docker-compose.yml https://raw.githubusercontent.com/bookorbit/bookorbit/main/docker-compose.yml
```

Edit `.env` and set these required values:

```dotenv
APP_URL=http://your-server-ip:3000   # the URL you'll open in your browser
BOOKS_HOST_PATH=./books              # folder on your server where your book files live

POSTGRES_PASSWORD=         # database password           - openssl rand -hex 24
JWT_SECRET=                # signs login tokens          - openssl rand -hex 32
SETUP_BOOTSTRAP_TOKEN=     # one-time setup wizard token - openssl rand -hex 16
```

Optionally set `LIBRARY_BROWSE_ROOT=/books` to start the library folder picker at `/books` instead of `/`.

Then start:

```bash
docker compose up -d
```

Open `http://your-server-ip:3000` and complete setup using your `SETUP_BOOTSTRAP_TOKEN`.

For the full installation guide including reverse proxy setup, file permissions on NAS, external databases, and environment variable reference, see **[bookorbit.app/installation](https://bookorbit.app/installation.html)**.

---

## KOReader Plugin

The BookOrbit plugin for KOReader adds progress sync, two-way annotation sync, and a native catalog browser: navigate, search, and download books from your library without leaving the device.

1. In BookOrbit, go to **Settings > Integrations > KOReader** and click **Download Plugin**.
2. Unzip `bookorbit.koplugin.zip`.
3. Copy `bookorbit.koplugin` to `koreader/plugins/` on the device.
4. Restart KOReader and open a book.
5. Use **Tools > BookOrbit Sync** to connect.

The download is pre-configured with your server URL and credentials; no manual entry on the device. For full setup and sync options, see **[bookorbit.app/koreader-plugin](https://bookorbit.app/koreader-plugin.html)**.

---

## Documentation and Contributing

Full documentation is at **[bookorbit.app](https://bookorbit.app/what-is-bookorbit.html)** - covering libraries, metadata, readers, Kobo sync, OPDS, users and permissions, OIDC setup, and more.

For local development, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). To contribute, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full workflow: branch naming, test expectations, PR checklist, and commit format.

---

## Translations

BookOrbit is available in English, German, Dutch, Brazilian Portuguese, and Slovenian. Translations are managed through [Crowdin](https://crowdin.com/project/bookorbit).

[![German translation](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbadges.awesome-crowdin.com%2Fstats-17791545-912891.json&query=%24.progress.0.data.translationProgress&label=German&logo=crowdin&color=blue&style=flat-square)](https://crowdin.com/project/bookorbit)
[![Dutch translation](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbadges.awesome-crowdin.com%2Fstats-17791545-912891.json&query=%24.progress.2.data.translationProgress&label=Dutch&logo=crowdin&color=blue&style=flat-square)](https://crowdin.com/project/bookorbit)
[![Brazilian Portuguese translation](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbadges.awesome-crowdin.com%2Fstats-17791545-912891.json&query=%24.progress.3.data.translationProgress&label=Portuguese%20%28Brazil%29&logo=crowdin&color=blue&style=flat-square)](https://crowdin.com/project/bookorbit)
[![Slovenian translation](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fbadges.awesome-crowdin.com%2Fstats-17791545-912891.json&query=%24.progress.4.data.translationProgress&label=Slovenian&logo=crowdin&color=blue&style=flat-square)](https://crowdin.com/project/bookorbit)

[Help improve BookOrbit translations on Crowdin](https://crowdin.com/project/bookorbit).

---

## Support

- **Questions and discussion:** [GitHub Discussions](https://github.com/bookorbit/bookorbit/discussions)
- **Bug reports:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml)
- **Feature requests:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml)

---

## License

BookOrbit is licensed under the **[GNU Affero General Public License v3.0](LICENSE)**.
