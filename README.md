<div align="center">

# BookOrbit

A self-hosted library and reading platform for ebooks, PDFs, audiobooks, and comics.

[![Latest release](https://img.shields.io/github/v/release/bookorbit/bookorbit?label=latest&style=flat-square)](https://github.com/bookorbit/bookorbit/releases)
[![Stars](https://img.shields.io/github/stars/bookorbit/bookorbit?style=flat-square&color=FFC72C)](https://github.com/bookorbit/bookorbit/stargazers)
[![CI](https://img.shields.io/github/actions/workflow/status/bookorbit/bookorbit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/bookorbit/bookorbit/release.yml?style=flat-square&label=release)](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml)
[![Coverage](https://img.shields.io/codecov/c/github/bookorbit/bookorbit?style=flat-square&flag=server&token=F6TADEFCUV&label=server%20coverage)](https://codecov.io/gh/bookorbit/bookorbit)
[![Crowdin](https://img.shields.io/badge/Crowdin-translate-2E3340?style=flat-square&logo=crowdin&logoColor=white)](https://crowdin.com/project/bookorbit)

[![Website](https://img.shields.io/badge/Website-bookorbit.app-blue?style=flat-square&logo=googlechrome&logoColor=white&color=4169E1)](https://bookorbit.app)
[![Demo](https://img.shields.io/badge/Demo-live-brightgreen?style=flat-square&logo=rocket&logoColor=white&color=40a829)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)
[![GHCR Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fbookorbit%2Fbookorbit%2Fbookorbit&query=downloadCount&label=Docker%20Pulls&logo=docker&style=flat-square&color=2496ed)](https://github.com/bookorbit/bookorbit/pkgs/container/bookorbit)
[![Contributing](https://img.shields.io/badge/Contributing-guide-orange?style=flat-square&logo=handshake&logoColor=white)](https://github.com/bookorbit/bookorbit/blob/main/docs/CONTRIBUTING.md)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=flat-square&color=B461B3)](LICENSE)

![BookOrbit dashboard showing reading stats, widgets, and book shelves](docs/images/dashboard-overview.png)

</div>

---

## What is BookOrbit?

**[BookOrbit](https://bookorbit.app)** organizes your books and reads them back to you anywhere: the web reader, a Kobo, or KOReader. Progress, highlights, and reading status move between all three, so you can start a chapter in one place and finish it in another.

Around that core sit 14 metadata providers, reading statistics and achievements, OPDS and Send-to-Kindle delivery, multi-user accounts with OIDC/SSO, and automatic sync out to Hardcover, Readwise, and StoryGraph. All of it runs on infrastructure you control.

[![Visit Website](https://img.shields.io/badge/Visit%20Website-bookorbit.app-4169E1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://bookorbit.app)

## Live Demo

Try the live instance before you install. No account required.

[![Launch Live Demo](https://img.shields.io/badge/Launch%20Live%20Demo-2ea44f?style=for-the-badge&logo=rocket&logoColor=white)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)

> **Note:** The demo includes a sample library of public domain books. Some administrative features are limited in the public demo. Self-hosting BookOrbit provides the full experience.

## Features

### Reading Experience & Sync

- **Built-in Web Readers**: Ebooks (EPUB, KEPUB, MOBI, AZW3, AZW, FB2), PDFs, comics (CBZ, CBR, CB7), and audiobooks (M4B, MP3, M4A, OPUS, OGG, FLAC), with no extra plugins required.
- **Three-Way Sync (Kobo + KOReader + BookOrbit)**: Progress and annotations flow bidirectionally between Kobo devices, KOReader, and the BookOrbit web reader. Pick up on any surface where you left off on another, including highlights and deletions.
- **KOReader Plugin**: An on-device catalog browser with search, download, and status and rating management, alongside full progress and annotation sync.
- **Annotations & Highlights**: Highlights from the web reader, KOReader, and Kobo merge into one searchable hub. Filter by color, style, and source; export as Markdown, CSV, or JSON.
- **Hardcover, Readwise & StoryGraph Sync**: Push status, progress, reading dates, and ratings to Hardcover on configurable triggers; status and progress to The StoryGraph; and new highlights and notes to Readwise as you create them, from both the web reader and synced devices. Hardcover read history can be pulled back to backfill blank BookOrbit entries.
- **Statistics, Goals & Achievements**: Daily reading time, heatmaps, streaks, and library health, plus yearly goals, monthly challenges, and 50+ achievements across five categories. Reading DNA profiles your reading style from your actual session history.

### Library Management

- **Multiple Libraries**: Isolate content with per-library folders, custom scan rules, and format priorities.
- **14 Metadata Providers**: Google Books, Open Library, Amazon, Goodreads, Kobo, Hardcover, Audible, Audnexus, Libro.fm, and iTunes, plus ComicVine for comics, RanobeDB for light novels, and Aladin and Lubimyczytać for Korean and Polish catalogs. Cover art is sourced separately from iTunes, DuckDuckGo, and AudiobookCovers.
- **Smart Scopes & Collections**: Organize your collection with curated lists and dynamic, rule-based saved filters.

### Platform & Delivery

- **Multi-User & SSO**: Granular per-user permissions and isolated reading data, with native support for Authentik, Keycloak, and Authelia via OIDC.
- **Multilingual Interface**: Community translations are managed on [Crowdin](https://crowdin.com/project/bookorbit). See the [localization guide](docs/LOCALIZATION.md) for current language support and contributor instructions.
- **Content Delivery**: OPDS support for compatible apps, Send-to-Kindle via email, and browser drag-and-drop uploads.
- **Automated Ingestion**: Configure a Book Dock drop folder for hands-free importing.

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

On a NAS, or any host where your book folder is owned by a user other than UID 1000, also set `PUID` and `PGID` to match that owner. Run `id -u` and `id -g` as the owning user to find them. Getting these wrong is the most common cause of permission errors on first scan.

Optionally set `LIBRARY_BROWSE_ROOT=/books` to start the library folder picker at `/books` instead of `/`.

Then start:

```bash
docker compose up -d
```

Open `http://your-server-ip:3000` and complete setup using your `SETUP_BOOTSTRAP_TOKEN`.

For the full installation guide including reverse proxy setup, file permissions on NAS, external databases, and environment variable reference, see **[bookorbit.app/installation](https://bookorbit.app/installation)**.

## KOReader Plugin

The BookOrbit plugin for KOReader adds progress sync, two-way annotation sync, and a native catalog browser: navigate, search, and download books from your library without leaving the device.

![BookOrbit KOReader Plugin showing dashboard, catalog search, and book details](docs/images/koreader-plugin-preview.png)

1. In BookOrbit, go to **Settings > KOReader**, create credentials if prompted, and click **Download Plugin**.
2. Unzip `bookorbit.koplugin.zip`.
3. Copy `bookorbit.koplugin` to `koreader/plugins/` on the device.
4. Restart KOReader and open a book.
5. Use **Tools > BookOrbit Sync** to connect.

The download is pre-configured with your server URL and credentials, so there is no manual entry on the device. For full setup and sync options, see **[bookorbit.app/koreader-plugin](https://bookorbit.app/koreader-plugin)**.

## Documentation and Contributing

Full documentation is at **[bookorbit.app](https://bookorbit.app/what-is-bookorbit)**, covering libraries, metadata, readers, Kobo sync, OPDS, users and permissions, OIDC setup, and more.

For setting up book requests, see the [book requests guide](docs/BOOK_REQUESTS.md): indexers,
download clients, path mappings, automation, and the encryption key they all need.
For a one-time import from Audiobookshelf, see the [Audiobookshelf migration guide](docs/AUDIOBOOKSHELF_MIGRATION.md).
For a stopped-snapshot import from Calibre-Web Automated, see the
[Calibre-Web Automated migration guide](docs/CALIBRE_WEB_AUTOMATED_MIGRATION.md).
For local development, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). To contribute, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full workflow: branch naming, test expectations, PR checklist, and commit format.

## Repository Activity

![BookOrbit repository activity: commits, issues, and pull requests over the last 30 days](https://repobeats.axiom.co/api/embed/f572f532340ae02697af0a164e3839818071be2c.svg)

## Translations

Help translate BookOrbit into your language on [Crowdin](https://crowdin.com/project/bookorbit).

When adding user-facing text in code, add the Vue I18n key only to `client/src/locales/en.json`. Do not edit non-English catalogs in a feature pull request; untranslated keys fall back to English until Crowdin provides a translation. See [docs/LOCALIZATION.md](docs/LOCALIZATION.md) for the complete workflow.

[![Translation progress](https://raw.githubusercontent.com/bookorbit/bookorbit/generated-charts/translation-progress.svg)](https://crowdin.com/project/bookorbit)

## Star History

[![BookOrbit GitHub star history](https://raw.githubusercontent.com/bookorbit/bookorbit/generated-charts/star-history.svg)](https://github.com/bookorbit/bookorbit/stargazers)

## Support

- **Questions and discussion:** [GitHub Discussions](https://github.com/bookorbit/bookorbit/discussions)
- **Bug reports:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml)
- **Feature requests:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml)
- **Security vulnerabilities:** Follow the private reporting process in the [Security Policy](.github/SECURITY.md).

## License

BookOrbit is licensed under the **[GNU Affero General Public License v3.0](LICENSE)**.
