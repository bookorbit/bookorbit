# Migrating from Audiobookshelf

BookOrbit can perform a one-time import of reading state from Audiobookshelf. The migration matches
Audiobookshelf books to books that already exist in BookOrbit, maps Audiobookshelf users to existing
BookOrbit users, and imports the selected users' supported state.

This is an import, not a continuous synchronization. Keep both systems backed up until you have
reviewed the migration report and verified the imported state.

## Compatibility

Compatibility is declared only for versions covered by the disposable end-to-end suite.

| Mode     | Verified Audiobookshelf version | Verification                                                 |
| -------- | ------------------------------- | ------------------------------------------------------------ |
| Live API | 2.36.0                          | Full import, repeat-run idempotency, and database integrity  |
| Backup   | Backup produced by 2.36.0       | Live/backup normalization parity and dry-run planning parity |

Other Audiobookshelf versions may work, but they are not currently declared compatible. A missing
optional backup table produces a warning and omits that domain. A missing required table or column
causes validation to fail instead of importing incomplete or misidentified state.

Maintainers can exercise another image with:

```bash
ABS_E2E_IMAGE=ghcr.io/advplyr/audiobookshelf:<version> pnpm e2e:run -- migration-audiobookshelf
```

Do not broaden the compatibility declaration until both live API behavior and a backup produced by
that version pass the suite.

## Requirements

- The BookOrbit operator must have the `Manage App Settings` permission.
- Live API mode requires an Audiobookshelf access token for an `admin` or `root` user. Tokens for
  regular and guest users are rejected.
- Target books must already exist in a scanned BookOrbit library. Unmatched source books are reported
  and are not created automatically.
- Target BookOrbit user accounts must already exist. Audiobookshelf users are mapping candidates only;
  accounts, passwords, roles, and permissions are not copied.
- Configure `MIGRATION_ENCRYPTION_KEY` with a persistent 64-character hexadecimal key before saving a
  live API source. Without a valid key, saved source credentials are not encrypted at rest. Generate a
  key with `openssl rand -hex 32` and retain it for as long as the saved source is needed.

## Supported data

The first compatibility declaration covers:

- book identity and metadata used by the migration, including title, subtitle, authors, narrators,
  first series membership, ISBN, ASIN, publisher, year, language, description, genres, and tags;
- explicit user mapping to existing BookOrbit accounts;
- read, reading, and unread status from real Audiobookshelf progress records, including available start,
  finish, and update dates;
- multi-file audiobook position, resolved to the correct target audio file and file-local second;
- EPUB percentage and EPUB CFI position;
- separate audio and EPUB positions for mixed-format books;
- audio bookmarks with their absolute book position, title, and creation time;
- valid listening sessions; and
- matching by ISBN, ASIN, mapped file path, then title and author.

The migration reports unmatched books, ambiguous matches, malformed source records, and state owned by
unmapped users. It does not assign that state to another user.

Metadata is applied as an overlay per field. A field Audiobookshelf actually carries replaces the value
on the matched BookOrbit book; a field Audiobookshelf leaves empty is skipped rather than written as
empty. An Audiobookshelf book with no publisher therefore leaves an existing BookOrbit publisher intact.
An explicit value is still an overlay: `abridged: false` and a zero duration are written.

Author sort names come from the `Last, First` form Audiobookshelf stores. A backup carries that per
author. The live API only exposes one joined sort string per book, so it is applied when the book has
exactly one author, and other books fall back to sorting on the display name.

## Deferred and unavailable data

The following data is not imported:

- Audiobookshelf podcasts and podcast sessions;
- user account creation, credentials, roles, or permissions;
- annotations, because Audiobookshelf does not expose an equivalent annotation domain;
- playlists and Audiobookshelf collections;
- covers from the live API or artwork from backups;
- PDF or comic reading locations that cannot be represented as EPUB CFIs;
- reader preferences, playback devices, server settings, or Audiobookshelf permissions; and
- continuous or two-way synchronization after the migration.

## Live API mode

Use live mode when BookOrbit can reach the running Audiobookshelf server.

1. Enter a clean `http` or `https` origin such as `https://audiobookshelf.example.com`. Do not include
   credentials, a path, query parameters, or a fragment.
2. Enter an access token belonging to an Audiobookshelf `admin` or `root` user.
3. Enable private-network access only when the Audiobookshelf hostname resolves to a trusted local or
   private address.
4. Test the connection, save the source, and validate it before creating the dry run.

BookOrbit resolves and pins the destination address for each request, rejects redirects, applies request
timeouts and response-size limits, and rejects private or local destinations unless private-network
access is explicitly enabled. Use HTTPS when traffic crosses an untrusted network. In Docker,
`127.0.0.1` refers to the BookOrbit container itself; use a hostname or address reachable from that
container.

The API token is redacted from migration API responses. It must never be placed in logs, screenshots,
reports, or issue comments.

## Backup mode

Use backup mode when BookOrbit should read an Audiobookshelf `.audiobookshelf` backup from local storage.

1. Create a fresh backup with Audiobookshelf's backup feature.
2. Create a dedicated host directory for migration inputs and copy the backup into it.
3. Mount that directory read-only into the BookOrbit container. For example, add this entry to the app
   service's `volumes` list in `docker-compose.yml`:

   ```yaml
   - /host/path/to/migration-imports:/imports:ro
   ```

4. Set `MIGRATION_IMPORT_ROOT=/imports` in BookOrbit's `.env` and restart BookOrbit.
5. In the migration source form, enter the absolute container path, such as
   `/imports/audiobookshelf/backup.audiobookshelf` if that path exists under the mounted root.

`MIGRATION_IMPORT_ROOT` is a server-side authorization boundary. It must be an absolute path and cannot
be supplied through the migration request. BookOrbit resolves the configured root and backup path,
rejects paths and symlink targets outside the root, detects path swaps, requires a regular file, and
reads the archive through the already-authorized file handle. Use a dedicated read-only mount rather
than a broad filesystem root.

A compatible backup must be a ZIP archive containing exactly one `details` entry and one
`absdatabase.sqlite` entry. Archive entry counts and extracted sizes are bounded. BookOrbit copies only
the SQLite database to an owner-only temporary file and opens it read-only with SQLite defensive mode.

## Book and user mapping

Audiobookshelf stores paths as seen by the Audiobookshelf process. BookOrbit stores paths as seen by the
BookOrbit process. Add a prefix mapping when those paths differ. For example:

| Source prefix | Target prefix       |
| ------------- | ------------------- |
| `/audiobooks` | `/books/audiobooks` |

Mappings replace only the matching leading prefix. More specific prefixes take priority. Save and
validate the mappings before starting the live run. Path mapping is one matching strategy; ISBN, ASIN,
and title/author matching can still match books whose paths differ.

Review every suggested user mapping. Users left unmapped remain visible in the mapping workflow and
migration report, but their state is not imported. Do not map multiple people to one BookOrbit user
merely to clear a warning.

## Recommended workflow

1. Back up BookOrbit and Audiobookshelf.
2. Scan the target BookOrbit libraries and confirm the target book files are present.
3. Create and test an Audiobookshelf source in live API or backup mode.
4. Save the source and validate its capabilities.
5. Map source users to existing BookOrbit users.
6. Add and validate path mappings where mount paths differ.
7. Run a dry run and review matches, ambiguities, unmatched books, unmapped users, warnings, and per-user
   totals.
8. Resolve ambiguous matches and rerun the dry run until the plan is current.
9. Start the live migration and export the final report.
10. Verify several audiobook, EPUB, mixed-format, finished, and bookmarked examples before retiring the
    Audiobookshelf instance.

Repeating the same completed plan is designed to be idempotent, but it is not a substitute for reviewing
the first report and keeping backups.

## Troubleshooting

### The live server is unreachable

- Confirm the URL contains only an `http` or `https` origin and does not redirect.
- Test DNS and network reachability from the BookOrbit server or container, not only from a browser.
- In Docker, do not use `127.0.0.1` for a service running in another container or on the host.
- Confirm a reverse proxy permits the Audiobookshelf API endpoints and does not redirect them to a login
  page.
- A request times out after the bounded connector timeout. Investigate routing, DNS, firewall, or proxy
  behavior before retrying.

### Audiobookshelf privileges are insufficient

The access token must authorize as an Audiobookshelf `admin` or `root` user. Create or select an account
with that type, obtain its token, and retest the source. BookOrbit intentionally rejects tokens that can
read only the current user's state because a complete migration must enumerate users and their state.

### A private or local address is rejected

Private-network access is off by default. Enable it only when the configured Audiobookshelf destination
is trusted and intentionally hosted on a private or local network. BookOrbit validates every resolved
address and pins the selected address for the request to limit DNS rebinding.

### A backup path is missing or rejected

- Confirm `MIGRATION_IMPORT_ROOT` is set in the BookOrbit process and is absolute.
- Use the path inside the BookOrbit container, not the host path or a browser workstation path.
- Confirm the backup exists under the canonical import root and is readable by the BookOrbit process.
- Prefer a direct regular-file path. A symlink target that resolves outside the root is rejected.
- If the container uses a read-only root filesystem, mount the import directory explicitly as shown
  above; BookOrbit uses its writable temporary directory for bounded extraction.

### A backup is incompatible

Create a fresh backup with the verified Audiobookshelf version and retry. The backup must include valid
`details` and `absdatabase.sqlite` entries and the required users, library items, books, and media
progress schema. Missing optional author, series, listening-session, or library-folder tables are
reported as warnings. Missing required schema fails validation.

Do not manually modify the archive or SQLite schema to bypass validation. Preserve the original backup
and report the Audiobookshelf version and sanitized validation message when requesting compatibility
support.

### Books or users remain unresolved

- Confirm the target library scan completed before the dry run.
- Add a path-prefix mapping if the two applications see different mount paths.
- Check ISBN and ASIN metadata on both sides.
- Resolve ambiguous book matches explicitly in the dry-run workflow.
- Create the target BookOrbit user before mapping. The migration does not create accounts.
