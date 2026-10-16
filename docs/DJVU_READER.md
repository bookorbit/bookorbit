# DjVu reader

BookOrbit opens standalone and bundled DjVu documents with server-side DjVuLibre decoding.
The web reader supports page navigation, fit modes, zoom, spreads, virtualized continuous
scrolling, per-account progress and view preferences, and copying embedded OCR text from
the page-text panel. Text is the document's embedded OCR, not newly generated recognition.

DjVuLibre is included in the production image. Native development requires `ddjvu` and
`djvused` on PATH: `brew install djvulibre` on macOS or
`sudo apt-get install djvulibre-bin util-linux` on Debian/Ubuntu. Linux also requires `prlimit`.
DjVuLibre is a separately installed executable dependency, invoked without a shell.
Its source and license are available from [DjVuLibre upstream](https://djvu.sourceforge.net/).
When redistributing the container, preserve the distribution's package license notices and
provide corresponding DjVuLibre source as required by its GPL license.

## Bounds and caching

The configuration names and defaults are documented in `server/.env.example` and validated
in `server/src/config/env.validation.ts`. By default there are two concurrent operations,
a 30-second native-process timeout, a 256 MiB source limit and a 64 MiB rendered-page cache.
Reader requests are served first and queue at most 16 deep; overflow and reader requests
still queued after the timeout return HTTP 503. Import, upload, Book Dock and cover work wait
for a free decoder instead, because their callers already bound how many run at once.
Missing DjVuLibre tools return HTTP 503. Decoder failures and unsupported documents return
HTTP 422. The reader offers retry controls and preloads only the next spread.

Private source snapshots are limited to four documents and 512 MiB total. They are removed
on eviction and graceful shutdown. Each server process owns its caches; no library-wide
pre-rendering is performed. Source device, inode, size, modification time and change time
identify a snapshot. All access checks precede cache access or conditional responses.
Pages use private revalidation with ETags and bounded WebP output at quality 85. Revalidation,
cached pages and repeat page counts are answered from the file's identity and a remembered
page count, without a decoder slot or a source snapshot.

Maximum supported source dimensions are 40 million pixels per page, with at most 20,000 pages.
Rendering uses 1280, 1920 or 2560 pixels on the longest edge; the web reader requests 2560
so fit-width and zoom stay sharp. Linux decoder processes run under `prlimit` with 768 MiB
address space and 64 MiB output-file limits, and a CPU limit matching `DJVU_TIMEOUT_MS`.
macOS has the same queue, input, image-output and wall-clock limits, but does not use `prlimit`.
Production deployments should also set a container memory limit sized for the Node process,
image encoding and configured decoder concurrency.

## Supported files and API

Library scanning and uploads recognize `.djvu`. Uploaded content must match the DjVu magic
and form type; full structural and resource validation occurs before native reader decoding.
Library upload, adding an edition and Book Dock use the shared upload-format contract.
DjVu is available in library format restrictions, priorities, filters and document groups.
Duplicate detection classifies DjVu alongside other ebooks. Book pages and covers do not treat
DjVu as a comic, although it shares the image reader and its `cbx` settings.
Files stored before DjVu was a content format were recorded as supplements; the first scan after
upgrading is a full scan, which imports DjVu-only folders and promotes those files to content.
Scanning, uploads, Book Dock and cover re-extraction generate a first-page cover and page count
through the same bounded decoder as the reader. Titles fall back to the filename; OPF sidecars
and metadata providers remain available for bibliographic metadata.
Existing imports can use cover re-extraction to generate missing artwork. DjVu metadata
write-back is not supported.
Indirect documents and standalone pages requiring external dictionaries are rejected.
Bundle offsets must refer to validated internal components. Reference names containing path
separators, traversal or URL syntax are rejected. Files are copied through an opened descriptor
to private temporary directories, preventing subsequent source replacement from changing the
validated bytes decoded by the native tools.

Authenticated routes, with zero-based page indices:

- `GET /api/v1/djvu/files/:fileId/pages`: `{ pageCount }`
- `GET /api/v1/djvu/files/:fileId/pages/:pageIndex?size=1920`: WebP image; supported sizes are 1280, 1920 and 2560
- `GET /api/v1/djvu/files/:fileId/pages/:pageIndex/text`: `{ text }`; empty when the page has no OCR

Progress uses the existing one-based `pageNumber` contract. DjVu uses the existing `cbx`
settings group; no new serialized settings enum is introduced. KOReader DjVu progress is
treated as paged. Released iOS builds cannot open DjVu, so answers that pick a file for a client
leave it out unless the caller opts in: series continuation
(`GET /api/v1/series/:seriesId/books/:bookId/next`) offers DjVu only with `includeDjvu=true`,
which the web reader sends, and the Currently Reading and notebook `readFileId` never name a
DjVu file. Native iOS DjVu reading is outside this web-reader implementation.
Original downloads, OPDS and KOReader serve `image/vnd.djvu`. DjVu can be selected for ordinary
email recipients; Kindle email and native Kobo sync retain their supported-format restrictions.
Apply the generated database migration to enable saving DjVu email format preferences.
Page text is available for selection and copying; a positioned text layer, full-document
search, outlines and annotations are not implemented.

Run focused tests with `pnpm --dir server exec vitest run src/modules/reader/djvu` and
`pnpm --dir server exec vitest run src/modules/djvu`, plus
`pnpm e2e:run -- djvu-reader`. The E2E suite requires native tools and verifies real decoding,
OCR, authorization, conditional responses, progress, settings isolation, uploads and covers.
