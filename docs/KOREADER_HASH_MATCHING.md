# KOReader download matching

KOReader identifies books with a partial file hash. Kobo conversion and audio removal change the bytes, so the downloaded hash can differ from the library file's hash. BookOrbit registers the hash of the same open file descriptor it streams, preserving the source hash and explicit manual links.

## Registration and recovery

Delivered hashes are stored in file hash history. Registration and the owning library's match-cache revision update commit together. Duplicate deliveries do not increment that revision. Registration uses a transaction-local one-second lock timeout, so a busy library falls back to recovery rather than holding up the download for the database's full statement timeout.

If registration fails, an immutable hash-only entry is saved in the application's private retry directory. Replay runs at startup and every 30 seconds, with bounded batches and a retained directory cursor. Malformed files and symbolic links are removed without following links; directories are skipped. Failed registrations remain for another pass. Recovery does not need the delivered archive, including temporary audioless EPUBs that have already been deleted.

If both the database and retry storage fail, the download still succeeds and failures are logged. The lock timeout bounds database lock waits, not connection acquisition or all query execution.

## Manual links and review

An explicit manual link takes precedence over automatic hash matches. Removing it returns the hash to **KOReader Books to Review**. Automatic matching can still resolve that hash and sync progress; the review entry allows the user to choose another manual target. Dismissing a review entry does not disable automatic matching or delete synced progress. Previously synced statistics stay on their existing book.

The existing API routes and response fields remain compatible. The file-timestamp component of the match-cache token uses a global indexed lookup, so another library's file changes can trigger extra match refreshes. History revisions and manual links remain scoped to the user's access. Manifest pagination continues across token changes.

## Historical recovery limit

The one-time backfill recovers delivered identities from retained KEPUB cache artifacts whose source identity is still verifiable. It cannot recover pre-fix temporary audioless outputs, over-limit conversions, or other delivered variants whose bytes have already been deleted. Those hashes need a manual link or another download. New deliveries use registration and durable retry instead of depending on retained artifacts.
