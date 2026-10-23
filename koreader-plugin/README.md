# BookOrbit Sync plugin for KOReader

Syncs your KOReader reading life into BookOrbit:

- **Catalog browsing**: a reading-first dashboard on the device with libraries, collections, SmartScopes, authors, series and search, built from four configurable sections you choose the sources of. Mosaic or list view, read-status/format filters, downloads and bulk downloads, "On device" indicators, and a "Read" action for books already on the device.
- **Progress sync**: pulls progress on book open (with a conflict prompt), pushes periodically and on close/suspend.
- **Reading statistics**: uploads KOReader's per-page time events; BookOrbit turns them into reading sessions and daily stats.
- **Two-way highlights**: device highlights appear as native highlights on the web reader; highlights, edits and deletions made on the web come back to the device.
- **Status & ratings**: reading/complete/abandoned status and star ratings sync both ways, newest-change-wins.

Only books BookOrbit already knows about are synced, matched by the same partial-MD5 file hash KOReader uses internally. Unmatched books on the device are re-checked automatically as your library changes.

## Install (preconfigured, recommended)

1. In BookOrbit web settings: Settings > KOReader, create sync credentials (KOReader sync permission required on your account).
2. Click "Download preconfigured plugin". The zip embeds your server address and credentials.
3. Unzip and copy `bookorbit.koplugin/` into `koreader/plugins/` on your device.
4. Restart KOReader. The plugin configures itself on startup and removes the embedded credentials file.

Re-downloading later (e.g. after changing your password or server address) and reinstalling applies the new config, even over an existing login. Each download carries a generation stamp, so replaying an old zip after logging out won't log you back in.

## Install (manual)

1. Copy `bookorbit.koplugin/` from the repository into `koreader/plugins/` on your device.
2. Restart KOReader.
3. In BookOrbit web settings: Settings > KOReader, create sync credentials.
4. On the device: open KOReader's top menu and tap the BookOrbit icon (the bookshelf, just before the main menu). Signed out, it opens Sign in to BookOrbit: enter the server address, test it, then your KOReader login. Tools > BookOrbit (below Calibre) has Open BookOrbit and Settings too.

## Setup

Inside BookOrbit, the menu button (or a swipe down from the top edge, on any BookOrbit page) opens the BookOrbit menu: Sync now, Customize or Home, Files (close BookOrbit), every place in your library, Settings, Sync status and Help & about. In a book, the BookOrbit icon opens This book instead: this device's position beside BookOrbit's, Sync now, Open BookOrbit, and Jump or Stay when BookOrbit is further ahead. Sync now, Test connection and Recheck all books run in place: the sheet or page stays open and shows the progress, then how it went.

1. Settings > Sync > Auto-sync to sync books automatically. Leave the stock "Progress sync" plugin unconfigured to avoid double syncing.
2. Optional: Settings > Sync > Push while reading (default every 3 page turns, 0 disables mid-session pushes).
3. Optional: Settings > Opening BookOrbit: show the file browser, open BookOrbit when KOReader starts, or make BookOrbit home (at startup and whenever you close a book). The same page sets a one-tap gesture shortcut (it names anything a gesture already does before replacing it) and turns the menu bar icon off.
4. Optional: customize Home. It is a board of widgets over four pages (Home, Insights, Library, Decor): the first time it opens, pick a starting layout (Reader, Stats or Library), which only changes which of the first three comes first. Hold any widget, or use Customize in the BookOrbit menu, to move, resize, remove and add widgets; changes are kept per screen layout, so portrait and landscape can differ. Settings > Home also changes the starting layout, tile style and BookOrbit interface size (1.0x to 1.2x in 0.05x steps), or resets the board. Interface size scales text, controls, spacing and tap targets together; layouts reflow for the remaining space. Want to read and Up next in series need a server that advertises the dashboard-section capability, and A year ago needs a server that sends it; against an older server they show as empty, and Year in reading counts only this device's reading. "Tap Continue reading" (on by default) resumes an on-device book in one tap; hold for its actions. The Decor page holds the picture widgets: a reading buddy that reacts to your reading, the Chapter line (your current book as a metro line, with the time to each chapter; it appears after the book has been opened and closed once on this device), Next badge (needs a server that sends achievements, and achievements turned on), Gathering dust (one never-opened book on this device a day), Pages turned, Tree rings, Glyph of the day, an analog clock and the moon.
5. Optional: assign "BookOrbit: open", "BookOrbit: this book", "sync this book" or "sync all books" to gestures yourself.

Interface size defaults to 1.05x when no preference is saved. Existing scale choices are preserved.

To add a companion, choose Customize > Add widget > Decor: Reading dog, Reading rabbit, Reading owl, Reading penguin, Reading robot, Reading vampire, Reading dragon or Reading ghost. The original Reading buddy is the cat. Each companion reacts to reading, idle time, streak milestones, finishing a book and late-night sessions, with six distinct pixel-art poses. All support small, medium and large tiles; each widget keeps its selected character when the dashboard is saved.

The plugin extends KOReader's live menu order to keep its Tools entry below Calibre and its icon just before the main menu without replacing tabs or tools added by other plugins. Older BookOrbit-generated menu-order files are removed automatically; hand-maintained menu-order files keep their other entries.

Settings > About & updates checks for plugin updates; an available update also shows in the BookOrbit menu. Sync status shows whether sync is working, recent sync activity, and Technical details for bug reports.

## How syncing works

- With auto sync on: progress pulls on open (with conflict prompts), pushes every N page turns (debounced, skipped offline), and the whole book state (progress, highlights, status, rating, reading time) uploads from live memory on close and suspend.
- Sync now on This book: checks BookOrbit for newer progress first, then does the same snapshot on demand.
- Sync now in the BookOrbit menu (manual only): a full-library sweep - matches new books, then uploads reading time, highlights, statuses and progress for everything.
- Everything is incremental and resumable: watermarks, modification-time checks and change detection mean an interrupted sync just resumes, and resends are server-side no-ops.
- Plugin state lives in `settings/bookorbit_sync_state.lua`. Deleting it is safe: the next sync re-uploads everything and the server deduplicates.

A first sync on a device with years of history uploads in batches of 500 events (roughly 400 requests per 200k events, a few minutes of background work), and is safe to interrupt.

Status, rating and review conflicts use calendar dates: a same-day tie keeps the server value. Manual sync and sweeps return canonical state to open and closed books. KOReader has three status labels: read/skimmed map to Finished, on-hold/abandoned to On hold, and unread/want-to-read/reading/rereading to Reading. This coarser mapping clears stale completion after a reset without changing the richer BookOrbit status.

Reading sessions use the complete device identity, so devices sharing a name prefix remain independent. Older session IDs remain readable; affected legacy sessions are rebuilt from stored page events as fresh reading extends them. Historical deletion markers remain authoritative. Copying a statistics database while keeping its device ID deduplicates its events; assigning the copy a new ID counts that historical reading separately. Progress-only KOSync requests do not create reading-time sessions.

## Two-way highlight and bookmark sync

Requires server 0.4+; against an older server the plugin falls back to upload-only automatically. Bookmark sync additionally requires a server that advertises the `bookmarkSync` capability; on an older one the bookmark paths stay dormant and highlights sync exactly as before.

- Device to web: highlight positions (crengine xpointers) convert to reader CFIs, verified against the highlighted text, so they render as native, editable highlights on the web.
- Web to device: applied on book open (with auto sync on), on manual sync, and during the full sweep for closed books, with positions re-verified/re-anchored against the text.
- Deletions go both ways through a trash/restore flow, so nothing is lost outright.
- Identity is the highlight's creation datetime plus position, so extending a highlight on the device is recognized as a move, not a delete-and-recreate.
- Styles map across formats (e.g. squiggly <-> underline, invert, named colors <-> hex).
- Toggle via Settings > Sync > "Two-way highlights & bookmarks" (uploads keep working either way).

Original and text-only copies keep separate exchange acknowledgements, even on the same device. The web reader projects highlight positions into the selected EPUB and verifies the quote before drawing. Closed-book updates remain unverified until the live reader checks them; interrupted acknowledgements and failed live applies remain eligible for retry. Repeated text without a reliable location hint is left unresolved rather than placed arbitrarily.

For identical local copies with separate sidecars, the sweep selects the most recently opened file. Missing highlights and bookmarks on one copy do not delete server entries while another known copy exists. Delete in BookOrbit to propagate a deletion across identical copies. Closed-book highlights missing on reopen are retried as complete additions for live verification.

Position-only bookmarks (dogears) sync the same way:

- Device to web: the dogear xpointer converts to a reader CFI and shows up in the web reader's bookmark list. Its title is the note you attached, else the chapter, else the page.
- Web to device: applied on book open, on manual sync, and during the full sweep for closed books. The position is only placed when it resolves; an entry that does not is retried on the next exchange.
- Deletions and device-side renames propagate; the web has no rename surface yet, so edits flow device to web only.
- A dogear has no highlighted text to re-anchor against, so a converted position can sit slightly off where a highlight would have been repaired exactly.

New bookmarks retain their source file. Mapping into a structurally different sibling requires equivalent chapter text; otherwise the bookmark remains unresolved. Legacy bookmarks without source-file provenance remain listed, but the selected-file web reader and delivery to another device withhold their position until a source-device sync or a new bookmark request establishes it. Device-side renames update BookOrbit; an already-linked second device keeps its existing title because bookmark exchange has no edit operation.

## Limitations

- Web highlight changes reach a closed book only via a manual sweep or its next open.
- Web-created PDF highlights aren't supported (device PDF highlights sync up but aren't drawn over the PDF).
- Books with reading stats but no sidecar path sync reading time only, until the full sweep covers them.
- PDF bookmarks don't sync in either direction (the web has no PDF bookmark surface).
- A device clock far in the past can delay edit detection for web-modified highlights.
- The full sweep is manual-only; books you never reopen only sync when you run it.
- A cloned device with a different KOReader `device_id` double-counts reading time; clones keeping the same `device_id` deduplicate naturally.

### EPUB delivery defaults

With plugin 1.7.0 and a supported server, set the default in BookOrbit web Settings > KOReader > Sync Settings > KOReader EPUB delivery. Devices can override the credential default. In KOReader, BookOrbit > Download > Settings > Read-aloud EPUB delivery edits the same server device setting. The single-download dialog offers Use BookOrbit default and an override to the other EPUB variant. Existing local preferences are imported once when the server has no configured default, and interrupted transfers keep their captured variant.
