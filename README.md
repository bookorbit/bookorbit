> [!IMPORTANT]
> **Android beta testers needed:** The official BookOrbit Android app is in closed testing. [Join the Google Play beta](https://github.com/bookorbit/bookorbit/issues/2001) and stay enrolled for at least 14 days to help unlock its public release.

<div align="center">

<h1>
  <img src="docs/images/bookorbit-icon.png" alt="" width="128" height="128"><br>
  BookOrbit
</h1>

A self-hosted library and reading platform for ebooks, PDFs, audiobooks, and comics.

[![Latest release](https://img.shields.io/github/v/release/bookorbit/bookorbit?label=latest&style=flat-square)](https://github.com/bookorbit/bookorbit/releases)
[![Stars](https://img.shields.io/github/stars/bookorbit/bookorbit?style=flat-square&color=FFC72C)](https://github.com/bookorbit/bookorbit/stargazers)
[![GHCR Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fbookorbit%2Fbookorbit%2Fbookorbit&query=downloadCount&label=Docker%20Pulls&logo=docker&style=flat-square&color=2496ed)](https://github.com/bookorbit/bookorbit/pkgs/container/bookorbit)
[![CI](https://img.shields.io/github/actions/workflow/status/bookorbit/bookorbit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/bookorbit/bookorbit/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/bookorbit/bookorbit/release.yml?style=flat-square&label=release)](https://github.com/bookorbit/bookorbit/actions/workflows/release.yml)
[![Coverage](https://img.shields.io/codecov/c/github/bookorbit/bookorbit?style=flat-square&flag=server&token=F6TADEFCUV&label=server%20coverage)](https://codecov.io/gh/bookorbit/bookorbit)

[![Website](https://img.shields.io/badge/Website-bookorbit.app-blue?style=flat-square&logo=googlechrome&logoColor=white&color=4169E1)](https://bookorbit.app)
[![Demo](https://img.shields.io/badge/Demo-live-brightgreen?style=flat-square&logo=rocket&logoColor=white&color=40a829)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)
[![App Store](https://img.shields.io/badge/App_Store-download-0D96F6?style=flat-square&logo=appstore&logoColor=white)](https://apps.apple.com/us/app/bookorbit-the-official-app/id6811807346)
![Android coming soon](https://img.shields.io/badge/Android-coming_soon-3DDC84?style=flat-square&logo=android&logoColor=white)
[![Crowdin](https://img.shields.io/badge/Crowdin-translate-2E3340?style=flat-square&logo=crowdin&logoColor=white)](https://crowdin.com/project/bookorbit)
[![Contributing](https://img.shields.io/badge/Contributing-guide-orange?style=flat-square&logo=handshake&logoColor=white)](https://github.com/bookorbit/bookorbit/blob/main/CONTRIBUTING.md)

![BookOrbit dashboard showing reading stats, widgets, and book shelves](docs/images/dashboard-overview.png)

<p align="center">
  <a href="#what-is-bookorbit">Overview</a> &bull;
  <a href="#live-demo">Live Demo</a> &bull;
  <a href="#bookorbit-for-iphone-and-apple-watch">iOS &amp; Apple Watch</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#quick-start-docker">Quick Start</a> &bull;
  <a href="#managed-hosting">Managed Hosting</a> &bull;
  <a href="#koreader-plugin">KOReader</a> &bull;
  <a href="#documentation-and-contributing">Docs</a>
</p>

</div>

---

<a id="what-is-bookorbit"></a>

## 📚 What is BookOrbit?

**[BookOrbit](https://bookorbit.app)** organizes your books and lets you enjoy them anywhere: on iPhone, Apple Watch, the web, Kobo, or KOReader. Your reading progress, highlights, and status stay synchronized, so you can start a chapter in one place and continue in another.

Around that core sit 14 metadata providers, reading statistics and achievements, OPDS and Send-to-Kindle delivery, multi-user accounts with OIDC/SSO, and automatic sync out to Hardcover, Readwise, and StoryGraph. All of it runs on infrastructure you control.

[![Visit Website](https://img.shields.io/badge/Visit%20Website-bookorbit.app-4169E1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://bookorbit.app)

<a id="live-demo"></a>

## 🚀 Live Demo

Try the live instance before you install. No account required.

[![Launch Live Demo](https://img.shields.io/badge/Launch%20Live%20Demo-2ea44f?style=for-the-badge&logo=rocket&logoColor=white)](https://demo.bookorbit.app/magic?token=2d92cb900e184cf0eb8b11f72cffc6011673d1016e1b300d750eb3d76abc1572)

> **Note:** The demo includes a sample library of public domain books. Some administrative features are limited in the public demo. Self-hosting BookOrbit provides the full experience.

<a id="bookorbit-for-iphone-and-apple-watch"></a>

## 📱 BookOrbit for iPhone and Apple Watch

Take your library anywhere with the official native BookOrbit app. Read ebooks, PDFs, and comics; stream or download audiobooks; use text to speech; and keep reading offline. The app connects directly to your self-hosted BookOrbit server, while Apple Watch brings downloaded audiobooks and synchronized playback progress to your wrist.

![BookOrbit on iPhone showing the home screen, Read Along, and audiobook playback alongside the Apple Watch library](docs/images/ios-app-hero.webp)

<div align="center">

<a href="https://apps.apple.com/us/app/bookorbit-the-official-app/id6811807346"><img src="https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us?size=250x83" alt="Download BookOrbit on the App Store" width="162" height="54"></a>
<img src="docs/images/android-coming-soon.svg" alt="BookOrbit for Android: coming soon" width="162" height="54">

<sub>Requires BookOrbit v3.0.0 or later and iOS 26 or later. Apple Watch features require watchOS 26 or later.</sub>

</div>

<details>
<summary><strong>Explore all 14 screenshots</strong></summary>

### iPhone

![Ten BookOrbit iPhone screens showing the home experience, Read Along, audiobook playback, book requests, appearance customization, text to speech, reading activity, achievements, shelves, and offline downloads](docs/images/ios-app-gallery.webp)

### Apple Watch

![Four BookOrbit Apple Watch screens showing the offline library, the app menu, audiobook playback, and playback settings](docs/images/apple-watch-showcase.webp)

</details>

<a id="features"></a>

## ✨ Features

### Reading Experience & Sync

- **Built-in Web Readers**: Ebooks (EPUB, KEPUB, MOBI, AZW3, AZW, FB2), PDFs, comics (CBZ, CBR, CB7), and audiobooks (M4B, MP3, M4A, OPUS, OGG, FLAC), with no extra plugins required.
- **Native iPhone & Apple Watch Apps**: Read, listen, download, upload, and synchronize with your BookOrbit server from a native, offline-capable iPhone app. Send audiobooks to Apple Watch for independent offline playback and later progress reconciliation.
- **Three-Way Sync (Kobo + KOReader + BookOrbit)**: Progress and annotations flow bidirectionally between Kobo devices, KOReader, and the BookOrbit web reader. Pick up on any surface where you left off on another, including highlights and deletions.
- **KOReader Plugin**: An on-device catalog browser with search, download, and status and rating management, alongside full progress and annotation sync.
- **Annotations & Highlights**: Highlights from the web reader, KOReader, and Kobo merge into one searchable hub. Filter by color, style, and source; export as Markdown, CSV, or JSON.
- **Hardcover, Readwise & StoryGraph Sync**: Push status, progress, reading dates, and ratings to Hardcover on configurable triggers; status and progress to The StoryGraph; and new highlights and notes to Readwise as you create them, from both the web reader and synced devices. Hardcover read history can be pulled back to backfill blank BookOrbit entries.
- **Statistics, Goals & Achievements**: Daily reading time, heatmaps, streaks, and library health, plus yearly goals, monthly challenges, and 50+ achievements across five categories. Reading DNA profiles your reading style from your actual session history.

### Library Management

- **Multiple Libraries**: Isolate content with per-library folders, custom scan rules, and format priorities.
- **12 Metadata Providers**: Google Books, Open Library, Amazon, Goodreads, Kobo, Hardcover, Audible, Audnexus, Libro.fm, and iTunes, plus ComicVine for comics and RanobeDB for light novels. [External providers](docs/METADATA_PROVIDERS.md) add more, such as Douban, FantLab, J-Novel Club, Libris, LubimyCzytac and MangaBaka. Cover art is sourced separately from iTunes, DuckDuckGo, and AudiobookCovers.
- **Smart Scopes & Collections**: Organize your collection with curated lists and dynamic, rule-based saved filters.

### Platform & Delivery

- **Multi-User & SSO**: Granular per-user permissions and isolated reading data, with native support for Authentik, Keycloak, and Authelia via OIDC.
- **Multilingual Interface**: Community translations are managed on [Crowdin](https://crowdin.com/project/bookorbit). See the [localization guide](docs/LOCALIZATION.md) for current language support and contributor instructions.
- **Content Delivery**: OPDS support for compatible apps, Send-to-Kindle via email, and browser drag-and-drop uploads.
- **Automated Ingestion**: Configure a Book Dock drop folder for hands-free importing.

<a id="quick-start-docker"></a>

## 🐳 Quick Start (Docker)

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

If your local book folder is owned by a user other than UID 1000, also set `PUID` and `PGID` to match that owner. Getting these wrong is the most common cause of permission errors on first scan.

Then start:

```bash
docker compose up -d
```

Open `http://your-server-ip:3000` and complete setup using your `SETUP_BOOTSTRAP_TOKEN`.

For the full installation guide including reverse proxy setup, host file permissions, secrets from mounted files, external databases, OIDC hardening, and environment variable reference, see **[bookorbit.app/installation](https://bookorbit.app/installation)**.

<a id="managed-hosting"></a>

## ☁️ Managed Hosting

Prefer a hosted instance without managing Docker or servers? [Zenith offers BookOrbit hosting](https://zenith.hosting/host/bookorbit) with a web file browser for uploads, access controls, and resource usage insights.

[![Deploy with Zenith](https://cdn.zenith.hosting/buttons/deploy-with-zenith.svg)](https://zenith.hosting/host/bookorbit)

<a id="how-i-actually-use-bookorbit"></a>

## 📖 How I Actually Use BookOrbit

One read-along EPUB3 per book: listened to on iPhone, carried offline to Apple Watch for runs, read on a Kobo through KOReader, and picked up again on the laptop. One file, one reading position, no reconciling an audiobook against an ebook.

Read the full walkthrough at **[bookorbit.app/my-workflow](https://bookorbit.app/my-workflow)**.

<a id="koreader-plugin"></a>

## 🔄 KOReader Plugin

The BookOrbit plugin for KOReader adds progress sync, two-way annotation sync, and a native catalog browser: navigate, search, and download books from your library without leaving the device.

![BookOrbit KOReader Plugin on unbranded e-readers showing Home, book details, catalog browsing, dashboard customization, series, and navigation](docs/images/koreader-plugin-preview.webp)

1. In BookOrbit, go to **Settings > KOReader**, create credentials if prompted, and click **Download Plugin**.
2. Unzip `bookorbit.koplugin.zip`.
3. Copy `bookorbit.koplugin` to `koreader/plugins/` on the device.
4. Restart KOReader and open a book.
5. Use **Tools > BookOrbit Sync** to connect.

The download is pre-configured with your server URL and credentials, so there is no manual entry on the device. For full setup and sync options, see **[bookorbit.app/koreader-plugin](https://bookorbit.app/koreader-plugin)**.

<a id="documentation-and-contributing"></a>

## 🛠️ Documentation and Contributing

Full documentation lives at **[bookorbit.app](https://bookorbit.app/what-is-bookorbit)**: libraries, metadata, readers, Kobo sync, OPDS, users and permissions, OIDC and more.

**Guides**

- **Book requests**: indexers, download clients, path mappings, automation and the encryption key they need. See the [book requests guide](https://bookorbit.app/book-requests/).
- **Read-aloud**: optional STAlign generation and QuartzNet hardware acceleration. See [docs/READ_ALOUD.md](docs/READ_ALOUD.md).
- **External metadata providers**: add a source that runs beside BookOrbit, such as FantLab or MangaBaka, with [docs/METADATA_PROVIDERS.md](docs/METADATA_PROVIDERS.md), or build your own with [docs/BUILDING_METADATA_PROVIDERS.md](docs/BUILDING_METADATA_PROVIDERS.md).

**Contributing**

- **Local development**: architecture, first-time setup, running, testing and conventions in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **Contributing**: branch naming, test expectations, the PR checklist and commit format in [CONTRIBUTING.md](CONTRIBUTING.md).

<a id="support-bookorbit"></a>

## ❤️ Support BookOrbit

BookOrbit is built and maintained independently. Behind what appears to be a single product is a growing ecosystem: the core server and web application, Kobo and KOReader integrations, native iPhone and Apple Watch apps, and an Android app currently in development.

Each part requires its own engineering, testing, compatibility, release, and support work. Keeping the entire ecosystem moving at its current pace, without compromising quality, requires considerable time, focus, and energy. Support helps make that pace sustainable and creates more room for thoughtful development.

If BookOrbit is valuable to you and you would like to support its continued development, you can:

- [Get the official iPhone and Apple Watch app](https://apps.apple.com/us/app/bookorbit-the-official-app/id6811807346)
- [Support BookOrbit on Ko-fi](https://ko-fi.com/neonbookorbit)
- [Contribute through Open Collective](https://opencollective.com/bookorbit)
- [Star BookOrbit on GitHub](https://github.com/bookorbit/bookorbit)

Financial support is entirely optional. Using BookOrbit, recommending it to others, or starring the repository also makes a meaningful difference.

<a id="unsupported-storage-configurations"></a>

## ⚠️ Unsupported Storage Configurations

> [!WARNING]
> **NAS and network storage configurations are not supported.** BookOrbit requires a local filesystem with dependable semantics for every writable path, including book libraries, import folders, application data, and PostgreSQL data. Do not place these paths on SMB/CIFS, NFS, FUSE or cloud mounts, distributed filesystems, or similar storage, even when the storage is mounted as an ordinary directory.
>
> BookOrbit scans, moves, renames, and writes files while coordinating with its database and background jobs. Network and nonstandard filesystems can behave differently around atomic renames, locking, file notifications, permissions, caching, consistency, and durability. A configuration may appear to work and later cause intermittent failures, incomplete moves, stale library state, data loss, or corruption.
>
> Such configurations may work in a particular environment, but using them is entirely at your own risk. No support is provided for them. Please do not open GitHub issues for problems encountered with these configurations unless the problem can be reproduced using supported local storage.

<a id="repository-activity"></a>

## 📈 Repository Activity

![BookOrbit repository activity: commits, issues, and pull requests over the last 30 days](https://repobeats.axiom.co/api/embed/f572f532340ae02697af0a164e3839818071be2c.svg)

<a id="translations"></a>

## 🌐 Translations

Help translate BookOrbit into your language on [Crowdin](https://crowdin.com/project/bookorbit).

When adding user-facing text in code, add the Vue I18n key only to `client/src/locales/en.json`. Do not edit non-English catalogs in a feature pull request; untranslated keys fall back to English until Crowdin provides a translation. See [docs/LOCALIZATION.md](docs/LOCALIZATION.md) for the complete workflow.

[![Translation progress](https://raw.githubusercontent.com/bookorbit/bookorbit/generated-charts/translation-progress.svg)](https://crowdin.com/project/bookorbit)

<a id="star-history"></a>

## ⭐ Star History

[![BookOrbit GitHub star history](https://raw.githubusercontent.com/bookorbit/bookorbit/generated-charts/star-history.svg)](https://github.com/bookorbit/bookorbit/stargazers)

<a id="help-and-community"></a>

## 💬 Help and Community

- **Questions and help:** [Ask in GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=question.yml) or [browse help requests](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Asupport).
- **Community conversations:** [Start a conversation](https://github.com/bookorbit/bookorbit/issues/new?template=discussion.yml) or [browse community topics](https://github.com/bookorbit/bookorbit/issues?q=is%3Aissue%20label%3Adiscussion).
- **Bug reports:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=bug_report.yml)
- **Feature requests:** [GitHub Issues](https://github.com/bookorbit/bookorbit/issues/new?template=feature_request.yml)
- **Security vulnerabilities:** Follow the private reporting process in the [Security Policy](.github/SECURITY.md).

Questions are welcome, even if you are unsure whether something is a bug. Share workflows, your setup, or companion apps in community conversations. See the [community guide](docs/COMMUNITY.md) for choosing a category and how topics are handled.

<a id="a-note-on-the-api"></a>
<a id="api-compatibility"></a>

## 🔌 API Compatibility

> [!IMPORTANT]
> BookOrbit's API evolves alongside its official clients. Backwards compatibility is maintained for released official apps, but the API is not currently a stable public integration surface, and compatibility with third-party clients is not guaranteed. For the most reliable experience, use the official apps, OPDS, Kobo sync, or the KOReader plugin.

<a id="license-and-attribution"></a>

## ⚖️ License and Attribution

Copyright (C) 2025-2026 neon and BookOrbit contributors.

BookOrbit is licensed under the **[GNU Affero General Public License v3.0 only](LICENSE)**.

BookOrbit material whose copyright holders have authorized them is also subject to the **[BookOrbit Additional Terms](ADDITIONAL_TERMS.md)** under sections 7(b), 7(c), 7(d), and 7(e) of the GNU AGPL v3. See the **[Attribution and Legal Notice](NOTICE)** for the required attribution.
