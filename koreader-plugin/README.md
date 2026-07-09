# BookOrbit Sync plugin for KOReader

Syncs your KOReader reading life into BookOrbit:

- **Catalog browsing**: a reading-first dashboard on the device with libraries, collections, SmartScopes, authors, series and search. Mosaic or list view, read-status/format filters, downloads and bulk downloads, "On device" indicators, and a "Read" action for books already on the device.
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
4. On the device: Tools > BookOrbit (sits below Calibre) - set the server address, log in, and use "Open dashboard" to browse/download books.

## Setup

1. Tools > BookOrbit > "Auto sync current book" to sync the open book automatically. Leave the stock "Progress sync" plugin unconfigured to avoid double syncing.
2. Optional: Settings > Sync > "Periodically sync every # pages" (default 10, 0 disables mid-session pushes).
3. Optional: Settings > Dashboard > "Open dashboard on startup".
4. Optional: assign "BookOrbit: sync this book" / "sync all books" to gestures.

The plugin manages `settings/reader_menu_order.lua` and `settings/filemanager_menu_order.lua` to keep its menu entry pinned below Calibre across updates; delete those files to reset your menu order.

From the dashboard menu, the plugin update check is top-level; from the Tools menu, it lives under Settings > Plugin.

## How syncing works

- With auto sync on: progress pulls on open (with conflict prompts), pushes every N page turns (debounced, skipped offline), and the whole book state (progress, highlights, status, rating, reading time) uploads from live memory on close and suspend.
- "Sync current book now": checks BookOrbit for newer progress first, then does the same snapshot on demand.
- "Sync all books now" (manual only): a full-library sweep - matches new books, then uploads reading time, highlights, statuses and progress for everything.
- Everything is incremental and resumable: watermarks, modification-time checks and change detection mean an interrupted sync just resumes, and resends are server-side no-ops.
- Plugin state lives in `settings/bookorbit_sync_state.lua`. Deleting it is safe: the next sync re-uploads everything and the server deduplicates.

A first sync on a device with years of history uploads in batches of 500 events (roughly 400 requests per 200k events, a few minutes of background work), and is safe to interrupt.

## Two-way highlight sync

Requires server 0.4+; against an older server the plugin falls back to upload-only automatically.

- Device to web: highlight positions (crengine xpointers) convert to reader CFIs, verified against the highlighted text, so they render as native, editable highlights on the web.
- Web to device: applied on book open (with auto sync on), on manual sync, and during the full sweep for closed books, with positions re-verified/re-anchored against the text.
- Deletions go both ways through a trash/restore flow, so nothing is lost outright.
- Identity is the highlight's creation datetime plus position, so extending a highlight on the device is recognized as a move, not a delete-and-recreate.
- Styles map across formats (e.g. squiggly <-> underline, invert, named colors <-> hex).
- Toggle via Settings > Sync > "Two-way highlight sync" (uploads keep working either way).

## Limitations

- Web highlight changes reach a closed book only via a manual sweep or its next open.
- Web-created PDF highlights aren't supported (device PDF highlights sync up but aren't drawn over the PDF).
- Books with reading stats but no sidecar path sync reading time only, until the full sweep covers them.
- Position-only bookmarks (no highlighted text) don't sync.
- A device clock far in the past can delay edit detection for web-modified highlights.
- The full sweep is manual-only; books you never reopen only sync when you run it.
- A cloned device with a different KOReader `device_id` double-counts reading time; clones keeping the same `device_id` deduplicate naturally.
