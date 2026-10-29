# KOReader download matching

KOReader identifies books with a partial file hash. Kobo conversion and audio removal change the bytes, so the downloaded hash can differ from the library file's hash. BookOrbit registers the hash of the same open file descriptor it streams, preserving the source hash and explicit manual links.

## Registration and recovery

Delivered hashes are stored in file hash history. Registration and the owning library's match-cache revision update commit together. Duplicate deliveries do not increment that revision. Registration uses a transaction-local one-second lock timeout, so a busy library falls back to recovery rather than holding up the download for the database's full statement timeout.

If registration fails, an immutable hash-only entry is saved in the application's private retry directory. Replay runs at startup and every 30 seconds, with bounded batches and a retained directory cursor. Malformed files and symbolic links are removed without following links; directories are skipped. Failed registrations remain for another pass. Recovery does not need the delivered archive, including temporary audioless EPUBs that have already been deleted.

If both the database and retry storage fail, the download still succeeds and failures are logged. The lock timeout bounds database lock waits, not connection acquisition or all query execution.

## Manual links and review

An explicit manual link takes precedence over automatic hash matches. Removing it returns the hash to **KOReader Books to Review**. Automatic matching can still resolve that hash and sync progress; the review entry allows the user to choose another manual target. Dismissing a review entry does not disable automatic matching or delete synced progress. Previously synced statistics stay on their existing book.

The existing API routes and response fields remain compatible. The file-timestamp component of the match-cache token uses a global indexed lookup, so another library's file changes can trigger extra match refreshes. History revisions and manual links remain scoped to the user's access. Manifest pagination continues across token changes.

## Links to a different copy

A manual link usually points a device copy at a library file with different bytes, such as a book
calibre sent to the device with its own metadata written in. Positions in that copy cannot be placed
in the library file, so the link syncs reading status, rating, reading time and progress as a
percentage, but not highlights, bookmarks or exact positions. Match-check marks such a match with
`positionCompatible: false`, and the highlight and bookmark exchanges list it under
`positionIncompatible`, never under `unmatched`: plugins read `unmatched` as "not in your library" and
drop the match. Plugin 2.0.0 ignores both fields, keeps the match and counts its skipped highlights as
uploaded; later plugins skip the exchange and say why.

A percentage-only place lands on a page boundary, so the plugin treats a remote place without a
position as the same place when it is within one page, and in page mode jumps to the nearest page
rather than the page below.

## Link suggestions

`GET /koreader/unmatched-books/suggestions` offers library books whose title and set of authors equal
a linkable book to review's, compared after folding only case, Unicode compatibility forms and
whitespace. It is read only and scoped like the rest of the user's library: accessible libraries,
content filters, present books, and a primary file that is not audio, because a link targets the
primary file. A title shared by two or more books, or by more books than are checked, is never offered
as a single suggestion. Nothing links until the user confirms through the ordinary link route.

## Historical recovery limit

The one-time backfill recovers delivered identities from retained KEPUB cache artifacts whose source identity is still verifiable. It cannot recover pre-fix temporary audioless outputs, over-limit conversions, or other delivered variants whose bytes have already been deleted. Those hashes need a manual link or another download. New deliveries use registration and durable retry instead of depending on retained artifacts.
