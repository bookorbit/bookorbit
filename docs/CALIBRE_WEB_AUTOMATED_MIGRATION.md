# Migrating from Calibre-Web Automated

BookOrbit can perform a one-time import from Calibre-Web Automated, abbreviated CWA. The migration
matches CWA books to books that already exist in BookOrbit, maps CWA users to existing BookOrbit users,
and imports supported reading state and static shelves.

This is an import, not continuous synchronization. Keep the original CWA installation and both systems'
backups until you have reviewed the migration report and verified the imported state.

## Compatibility

Compatibility is declared only for snapshots covered by the disposable end-to-end suite.

| Snapshot producer | Verified result                                                                        |
| ----------------- | -------------------------------------------------------------------------------------- |
| CWA v4.0.6        | Full stopped-snapshot import, repeat-run idempotency, user isolation, and DB integrity |

CWA's `app.db` and Calibre's `metadata.db` do not contain a trustworthy CWA release number. BookOrbit
therefore reports the source version as unknown and emits this expected warning:

```text
Schema compatibility was verified against Calibre-Web Automated v4.0.6
```

That warning does not mean validation failed. Other CWA versions may work, but they are not currently
declared compatible. Missing optional tables produce precise warnings and disable only the affected
domain. Missing core book, file, or user columns cause validation to fail.

Maintainers can exercise another literal published image tag with:

```bash
CWA_E2E_IMAGE=crocodilestick/calibre-web-automated:<published-tag> \
  pnpm e2e:run -- migration-calibre-web-automated
```

CWA's historical Docker tag casing is not consistent. Use the exact published tag rather than building
one from a version number. Do not broaden the compatibility declaration until the complete suite passes.

## Requirements

- The BookOrbit operator must have the `Manage App Settings` permission.
- Target books must already exist in a scanned BookOrbit library. Unmatched source books are reported
  and are not created automatically.
- Target BookOrbit user accounts must already exist. CWA users are mapping candidates only; accounts,
  passwords, roles, tokens, sessions, and permissions are never copied.
- BookOrbit must have a dedicated server-side import directory configured through
  `MIGRATION_IMPORT_ROOT`.
- CWA must be fully stopped while `app.db` and its corresponding `metadata.db` are copied.

The two databases are independent SQLite files. Neither CWA nor BookOrbit can make a live copy of them
represent one shared instant. BookOrbit can detect active journal or WAL files beside the submitted
snapshots, but it cannot prove that snapshots copied elsewhere were taken consistently. Stopping CWA
before the copy is therefore required even when validation succeeds.

## Supported data

The first compatibility declaration covers:

- non-Guest CWA users as explicit mapping candidates, including administrators and regular users;
- Calibre books and individual formats;
- title, ordered authors and sort names, ISBN, ASIN and supported provider identifiers, publisher,
  publication year, language, series, rating, description, and tags;
- unread, reading, and read status with available start, finish, and update dates;
- web-reader EPUB CFI resume position;
- web-reader audio position converted from milliseconds to seconds;
- web-reader comic position converted from CWA's zero-based image index to BookOrbit's one-based page;
- Kobo EPUB or KEPUB progress, preferring KEPUB when both formats exist;
- KOReader percentage and compatible EPUB locator when CWA's checksum index maps the document uniquely;
- static shelves and their relative book order; and
- matching by ISBN, ASIN, mapped file path, then title and author.

Calibre tags are imported as BookOrbit tags, not genres. Metadata is applied as an overlay: a field CWA
actually carries can replace that field on the matched BookOrbit book, while unavailable source fields
are left unchanged.

CWA's table named `bookmark` stores one current web-reader resume position. It does not represent a
collection of named bookmarks, so those rows become reading progress rather than BookOrbit bookmarks.

## Deferred and unavailable data

The following data is not imported:

- the default Guest account or state owned only by Guest;
- account credentials, OAuth data, API tokens, mail secrets, sessions, device secrets, or Hardcover
  tokens;
- user creation, roles, permissions, or authentication settings;
- narrators and genres, because CWA does not distinguish them reliably from Calibre tags;
- reading-session history;
- named bookmarks and annotations;
- covers;
- Magic Shelves, dynamic shelf rules, and public-sharing behavior;
- arbitrary Calibre custom columns;
- CWA operational data from `cwa.db`; and
- continuous or two-way synchronization after the migration.

A public CWA shelf is imported as a private collection owned by the mapped BookOrbit user. It is never
granted to another user automatically.

## Create a stopped-instance snapshot

The common CWA container paths are:

| Data                 | Typical CWA container path     |
| -------------------- | ------------------------------ |
| CWA application data | `/config/app.db`               |
| Calibre catalog      | `/calibre-library/metadata.db` |

Use the host paths bound to those container locations. If CWA selects a library below another folder,
copy the `metadata.db` belonging to the library currently configured in CWA, not another Calibre
catalog found on the host.

1. Back up the CWA config and Calibre library using your normal backup process.
2. Stop CWA completely. With the standard Compose service name:

   ```bash
   docker compose stop calibre-web-automated
   ```

3. Confirm the container is stopped. Replace the name if your deployment uses another container name:

   ```bash
   docker inspect -f '{{.State.Running}}' calibre-web-automated
   ```

   The command must print `false`.

4. Inspect both source directories for non-empty SQLite sidecars. Check for `app.db-wal`,
   `app.db-journal`, `metadata.db-wal`, and `metadata.db-journal`. Do not copy only a main database while
   one of these contains data. Do not delete a sidecar to make validation pass. Restart CWA, allow its
   recovery and startup work to finish, stop it cleanly, and check again.
5. While CWA remains stopped, copy exactly the two main database files into a dedicated BookOrbit import
   directory. For example:

   ```bash
   install -d -m 700 /host/path/to/bookorbit-migration-imports/cwa
   install -m 600 /host/path/to/cwa-config/app.db \
     /host/path/to/bookorbit-migration-imports/cwa/app.db
   install -m 600 /host/path/to/calibre-library/metadata.db \
     /host/path/to/bookorbit-migration-imports/cwa/metadata.db
   ```

6. Confirm the copied files are different regular files and that no copied `-wal` or `-journal`
   sidecars exist beside them.
7. CWA may be restarted after both copies are complete. BookOrbit reads only the copies.

If CWA was never allowed to finish startup migrations, optional KOReader tables may not exist. When
KOReader progress matters, let the same CWA version start fully and finish its checksum work before
stopping and recopying the databases.

## Configure the BookOrbit import root

Mount only the dedicated import directory read-only into the BookOrbit app container. For example, add
this entry to the app service's `volumes` list in `docker-compose.yml`:

```yaml
- /host/path/to/bookorbit-migration-imports:/imports:ro
```

Set the corresponding absolute container path in BookOrbit's `.env`:

```dotenv
MIGRATION_IMPORT_ROOT=/imports
```

Restart BookOrbit so it receives the environment value and mount. In the migration source form, select
Calibre-Web Automated and enter:

```text
Application database: /imports/cwa/app.db
Calibre metadata database: /imports/cwa/metadata.db
```

`MIGRATION_IMPORT_ROOT` is a server-side authorization boundary. It cannot be supplied or overridden by
the migration request. BookOrbit requires absolute paths, resolves the configured root and both files,
rejects symlinks or path traversal, requires two different regular files, copies them into owner-only
temporary storage, opens them read-only with SQLite defensive mode, runs integrity checks, and cleans up
the private copies after each operation.

Use paths as seen by the BookOrbit process or container. A host path that is not mounted at the same
location is not a valid migration path. Do not use `/`, a home directory, the CWA config directory, or a
broad storage mount as the import root.

## Book path mapping

The snapshot file location is not the source library root used for book matching. Book paths are based
on the logical Calibre library root stored in CWA's `app.db`, normally `/calibre-library`. A split-library
configuration may provide a different logical root. BookOrbit reports the detected prefix after source
validation.

Map that CWA-visible prefix to the path where the same files exist inside BookOrbit. For example:

| Source prefix      | Target prefix |
| ------------------ | ------------- |
| `/calibre-library` | `/books`      |

Mappings replace only the matching leading path prefix. The target prefix is not the host path unless
BookOrbit sees that exact path. Validate the mapping before creating the final dry run.

CWA does not provide BookOrbit file hashes, so mapped paths are especially important for books with
multiple files of the same media kind, such as EPUB and KEPUB together. ISBN, ASIN, and title/author
matching can still match books whose paths differ, but exact mapped paths give file-level progress the
strongest target-file signal.

## User mapping and recommended workflow

Review every suggested user mapping. Users left unmapped remain visible in source counts and reports,
but their status, progress, and shelves are not imported. Never map multiple people to one BookOrbit
account merely to clear a warning.

1. Back up BookOrbit and CWA.
2. Scan the target BookOrbit libraries and confirm the target files are present.
3. Stop CWA and create both snapshots as described above.
4. Configure the read-only import mount and `MIGRATION_IMPORT_ROOT`, then restart BookOrbit.
5. Create a Calibre-Web Automated source with the two snapshot paths.
6. Test the source, save it, and validate its capabilities and warnings.
7. Map selected CWA users to existing BookOrbit users.
8. Add and validate the logical-library path mapping.
9. Run a dry run and review match strategies, ambiguities, unmatched books, unmapped users, warnings,
   unavailable domains, and per-user totals.
10. Resolve ambiguous matches and create a current dry run.
11. Start the live migration and export the final report.
12. Verify representative EPUB, Kobo or KEPUB, KOReader, audio, comic, finished-status, and ordered-shelf
    examples before retiring the CWA installation or snapshots.

Repeating the same completed plan is designed to be idempotent, but it is not a substitute for reviewing
the first report and retaining backups.

## Troubleshooting

### A snapshot is reported as active or hot

BookOrbit rejects a submitted database when a non-empty `-wal` or `-journal` file exists beside it. Stop
CWA, discard the attempted copies, and create a fresh pair from the stopped installation. Do not remove
sidecars from a running installation or copy only the main database.

If the original stopped directories still contain non-empty sidecars, restart the same CWA installation,
allow recovery to complete, stop it cleanly, and inspect again. Preserve the original files and request
support if they remain; do not repair production databases in place merely to satisfy migration.

### The two database paths appear reversed

The application field must point to CWA's `app.db`, which contains the `user` table. The metadata field
must point to Calibre's `metadata.db`, which contains `books` and `data`. Correct the two fields and
retest. Renaming the wrong files does not make them compatible.

### A path is missing, outside the import root, or unreadable

- Confirm `MIGRATION_IMPORT_ROOT` is set in the BookOrbit process and is absolute.
- Use paths inside the BookOrbit container, not host-only or workstation paths.
- Confirm the read-only mount contains both files and the BookOrbit container user can read them.
- Keep both snapshots below the canonical import root and avoid symlinks.
- Confirm the paths identify two different regular files.

### The snapshot schema is incompatible

Confirm the files came from the same stopped CWA installation and that CWA had completed startup. Missing
required user, book, or file tables or columns fail validation. Do not edit SQLite tables or bypass
validation. Preserve the original snapshot pair and report the exact CWA image tag plus the sanitized
validation message when requesting compatibility support.

### Optional progress or shelves are unavailable

Missing `book_read_link`, web bookmark, Kobo, KOReader, checksum, or shelf tables disable only the related
domain and produce a warning. This can be legitimate when the feature was never used. If the source
installation should contain that data, start the same CWA version, allow its migrations and checksum work
to finish, stop it, and create a new snapshot pair.

### No CWA-specific schema signature is found

BookOrbit warns when the snapshot has compatible core Calibre-Web tables but none of the known CWA
signatures. The files may come from stock Calibre-Web or an unverified CWA schema. Review the warning and
source provenance carefully. A core-schema match is not proof of CWA compatibility.

### The logical library path is unsafe or missing

BookOrbit rejects traversal, backslashes, NULs, and unsafe absolute or relative path components. The
logical root comes from CWA configuration, not from the snapshot's host directory. Correct the library
configuration in CWA, let it start successfully, stop it, and create fresh snapshots rather than editing
the copies.

### Books or users remain unresolved

- Confirm the target BookOrbit library scan completed before the dry run.
- Map the CWA logical library prefix to the path visible inside BookOrbit.
- Check ISBN and ASIN metadata on both sides.
- Check title and author spelling when relying on the final fallback strategy.
- Resolve ambiguous book matches explicitly in the dry-run workflow.
- Create the target BookOrbit account before mapping. The migration does not create users.

Unmatched books remain in the report and do not prevent valid matched books from importing.
