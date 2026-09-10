# Library date added

Each library can use import time (the default), the earliest content-file modified time,
or the earliest content-file creation time for newly scanned books. Creation time falls
back to the same file's modified time when the filesystem does not provide a usable
creation time. Cover, metadata, and supplement files do not affect the date.

Save the source in the library editor before selecting **Recompute now** to update
existing books. Changing the source alone leaves existing dates untouched. Switching
back to import time cannot restore import dates overwritten by a previous recompute.

Recompute runs in the background, so the editor can be closed and reopened to check
progress. Results report updated, unchanged, skipped, and failed books. Creation-time recompute preserves the date of a book with any
unreadable content file. Modified-time recompute uses the timestamps stored by the scanner. Books without a usable date are skipped.
Updates are scoped to the selected library; books moved, deleted, or with concurrently edited dates
before a batch writes are skipped. Repeating the operation is safe and leaves unchanged
rows untouched.

At most two jobs run concurrently, with one job per library. Reads use batches of 100
books and 200 content files, with at most 10 concurrent filesystem operations per job.
Updates use one atomic statement per book batch. Failure samples include at most 10 book
IDs and error codes, never filesystem paths.

Job state is held in the running server process. Completed results are retained for up
to an hour, subject to a 64-library cache limit. A server restart interrupts running work;
already committed batches remain applied and the operation can be run again. The editor
reports missing status instead of assuming completion. This job runner assumes a single
application server, like the existing scanner job coordinator.

## API

Both endpoints require `manage_libraries` and editor access to the library:

- `POST /api/v1/libraries/:id/recompute-added-at` returns HTTP 202 and an
  `AddedAtRecomputeJob` from `@bookorbit/types`.
- `GET /api/v1/libraries/:id/recompute-added-at` returns the current or retained job,
  or `null` when no retained job belongs to the caller. Superusers can inspect any
  accessible library's job.

The source is captured when the job starts. Changing library settings during a run does
not change that job's source. A second start for the same library returns HTTP 409.
Capacity exhaustion returns HTTP 503. Import-time libraries return HTTP 400 because the
original import date is not separately stored. Polling every second is sufficient.
