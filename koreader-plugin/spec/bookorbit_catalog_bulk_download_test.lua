-- Proves the bulk download engine enumerates a manifest page at a time, links
-- from the manifest hash without a per-book detail or per-file match request,
-- resumes idempotently from its checkpoint, and falls back to paged catalog
-- enumeration when the server does not advertise the manifest.

local scheduled = {}
local prevent_calls = 0
local allow_calls = 0
local shown_widget

package.loaded["ui/bidi"] = {
    dirpath = function(value) return value end,
    filepath = function(value) return value end,
}
package.loaded["datastorage"] = {
    getSettingsDir = function() return "/tmp/bookorbit-spec" end,
    getDataDir = function() return "/tmp/bookorbit-spec" end,
}
package.loaded["dump"] = function(value) return tostring(value) end
package.loaded["ui/widget/buttondialog"] = {
    new = function(_, opts)
        opts = opts or {}
        function opts:setTitle(title)
            self.title = title
        end
        return opts
    end,
}
package.loaded["ui/widget/infomessage"] = {
    new = function(_, opts)
        return opts or {}
    end,
}
package.loaded["ui/widget/confirmbox"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/widget/inputdialog"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/widget/notification"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/uimanager"] = {
    preventStandby = function()
        prevent_calls = prevent_calls + 1
    end,
    allowStandby = function()
        allow_calls = allow_calls + 1
    end,
    scheduleIn = function(_, _, callback)
        table.insert(scheduled, callback)
    end,
    nextTick = function(_, callback)
        table.insert(scheduled, callback)
    end,
    show = function(_, widget)
        shown_widget = widget
    end,
    close = function() end,
    forceRePaint = function() end,
}

-- Fake filesystem: destination existence, sizes and partial digests are the
-- inputs restart validation depends on.
local files = {}
local hashes = {}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attribute)
        local entry = files[path]
        if not entry then return nil end
        if attribute == "size" then return entry.size end
        if attribute == "mode" then return "file" end
        return { mode = "file", size = entry.size }
    end,
    dir = function()
        return function() return nil end
    end,
}
package.loaded["logger"] = {
    dbg = function() end,
    warn = function() end,
}
package.loaded["ffi/util"] = {
    template = function(value, ...)
        local result = value
        for index = 1, select("#", ...) do
            local replacement = tostring(select(index, ...))
            result = result:gsub("%%" .. index, function()
                return replacement
            end)
        end
        return result
    end,
}
local made_paths = {}
package.loaded["util"] = {
    makePath = function(path)
        table.insert(made_paths, path)
    end,
    getSafeFilename = function(filename)
        return filename
    end,
    removeFile = function(path)
        files[path] = nil
    end,
    partialMD5 = function(path)
        return hashes[path]
    end,
    writeToFile = function()
        return true
    end,
}
package.loaded["gettext"] = function(text)
    return text
end
package.loaded["bookorbit_catalog_util"] = {
    cloneParams = function(value)
        local copy = {}
        for key, item in pairs(value or {}) do copy[key] = item end
        return copy
    end,
    formatBytes = function(value)
        return tostring(value)
    end,
    isSupportedFormat = function()
        return true
    end,
    safeFilenameBase = function()
        return "book"
    end,
    shortText = function(value)
        return value
    end,
}

local link_batches = {}
local unmatched_batches = {}
local applied_library_versions = {}
package.loaded["bookorbit_state_manager"] = {
    linkFiles = function(entries)
        table.insert(link_batches, entries)
        return #link_batches
    end,
    linkFile = function() end,
    mutateScoped = function(scope)
        table.insert(unmatched_batches, scope.digests)
    end,
    applyLibraryVersion = function(version)
        table.insert(applied_library_versions, version)
    end,
}

local transfers = {}
local transfer_result_hash
package.loaded["bookorbit_download_transfer"] = {
    sweepStale = function() return 0 end,
    run = function(opts)
        table.insert(transfers, opts.destination)
        files[opts.destination] = { size = opts.expected_bytes or 0 }
        local hash = transfer_result_hash and transfer_result_hash(opts) or nil
        hashes[opts.destination] = hash
        return true, nil, { hash = hash, bytes = opts.expected_bytes or 0 }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BulkDownload = require("bookorbit_catalog_bulk_download")
local CatalogDownload = require("bookorbit_catalog_download")
local Capabilities = require("bookorbit_capabilities")

local Catalog = {}
BulkDownload.install(Catalog)
CatalogDownload.install(Catalog)
-- The controller supplies the off-thread boundary; here it runs inline so the
-- test can drive each step deterministically.
function Catalog:runOffThread(fn)
    return fn()
end

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

G_reader_settings = {
    readSetting = function(_, key)
        if key == "download_dir" then return "/downloads" end
        return nil
    end,
}

assertEqual(Catalog:getLocalDownloadPath("fallback", "epub", "Series/Book.epub"), "/downloads/Series/Book.epub", "valid device path")
assertEqual(made_paths[1], "/downloads/Series", "valid device parent created")
assertEqual(Catalog:getLocalDownloadPath("fallback", "epub", "./Series//Book.epub"), "/downloads/Series/Book.epub", "dot segments normalized")
assertEqual(Catalog:getLocalDownloadPath("fallback", "epub", "../outside.epub"), "/downloads/fallback.epub", "parent traversal falls back")
assertEqual(Catalog:getLocalDownloadPath("fallback", "epub", "Series\\..\\..\\outside.epub"), "/downloads/fallback.epub", "mixed separator traversal falls back")
assertEqual(#made_paths, 2, "traversal paths do not create directories")

Catalog.settings = {}
Catalog:initBulkDownloadState()
Catalog.refreshOnDevice = function() end
Catalog.markStackDirty = function() end
Catalog.bookMode = function() return false end
Catalog.dashboardMode = function() return false end
Catalog.updateItems = function() end
Catalog.loadOnDevice = function() end
Catalog.isOnDevice = function() return false end
Catalog.onDeviceFilePath = function() return nil end
Catalog.supportedFiles = function(_, detail)
    return detail.files or {}
end

local checkpoint_store = { record = nil, saves = 0, cleared = 0 }
local fake_checkpoint = {
    load = function()
        return checkpoint_store.record
    end,
    save = function(_, record)
        checkpoint_store.saves = checkpoint_store.saves + 1
        checkpoint_store.record = record
        return record
    end,
    clear = function()
        checkpoint_store.cleared = checkpoint_store.cleared + 1
        checkpoint_store.record = nil
    end,
}
Catalog.bulkOpenCheckpoint = function()
    return fake_checkpoint
end

local calls
local function makeClient(opts)
    opts = opts or {}
    calls = { manifest = 0, books = 0, detail = 0, match = 0, version = 0 }
    return {
        server_url = "https://books.example.com/api/v1",
        username = "reader",
        getPluginVersion = function()
            calls.version = calls.version + 1
            if opts.version_error then return nil, opts.version_error end
            return { serverVersion = "1.0", capabilities = opts.capabilities or {} }
        end,
        catalogManifest = function(_, params)
            calls.manifest = calls.manifest + 1
            return opts.manifest(params)
        end,
        catalogBooks = function(_, params)
            calls.books = calls.books + 1
            return opts.books(params)
        end,
        catalogBook = function(_, id)
            calls.detail = calls.detail + 1
            return opts.detail and opts.detail(id) or nil
        end,
        matchCheck = function(_, digests)
            calls.match = calls.match + 1
            return opts.match and opts.match(digests) or { matches = {} }
        end,
    }
end

local function drain(limit)
    local runs = 0
    while #scheduled > 0 do
        runs = runs + 1
        if runs > (limit or 1000) then error("scheduler did not settle") end
        local callback = table.remove(scheduled, 1)
        callback()
    end
end

local function resetRun()
    scheduled = {}
    transfers = {}
    for path in pairs(files) do files[path] = nil end
    for path in pairs(hashes) do hashes[path] = nil end
    link_batches = {}
    unmatched_batches = {}
    applied_library_versions = {}
    checkpoint_store = { record = nil, saves = 0, cleared = 0 }
    fake_checkpoint.load = function() return checkpoint_store.record end
    fake_checkpoint.save = function(_, record)
        checkpoint_store.saves = checkpoint_store.saves + 1
        checkpoint_store.record = record
        return record
    end
    fake_checkpoint.clear = function()
        checkpoint_store.cleared = checkpoint_store.cleared + 1
        checkpoint_store.record = nil
    end
    Capabilities.reset()
    Catalog:initBulkDownloadState()
end

local function manifestBook(id, hash)
    return {
        id = id,
        title = "Book " .. id,
        formats = { "epub" },
        files = {
            {
                id = 100 + id,
                format = "epub",
                sizeBytes = 1000 + id,
                fileHash = hash,
                devicePath = "Books/Book" .. id .. ".epub",
            },
        },
    }
end

-- A manifest run pages through cursors and never issues a detail or match
-- request: the manifest hash is the digest local match state keys on.
resetRun()
transfer_result_hash = function(opts)
    return "hash" .. tostring(opts.expected_bytes)
end
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        if not params.cursor then
            return {
                items = { manifestBook(1, "hash1001"), manifestBook(2, "hash1002") },
                hasNext = true,
                nextCursor = "cursor-2",
                manifestVersion = "lib-v1",
                restartRequired = false,
            }
        end
        return {
            items = { manifestBook(3, "hash1003") },
            hasNext = false,
            nextCursor = nil,
            manifestVersion = "lib-v1",
            restartRequired = false,
        }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "All", total = 3, params = { sort = "title" } }
assertEqual(prevent_calls, 1, "starting a bulk download prevents standby")
drain()
assertEqual(#transfers, 3, "every manifest book transfers once")
assertEqual(calls.manifest, 2, "enumeration follows the cursor to completion")
assertEqual(calls.detail, 0, "manifest run issues no per-book detail request")
assertEqual(calls.match, 0, "a verified manifest hash needs no match request")
assertEqual(#link_batches, 2, "links flush once per manifest page, not once per file")
assertEqual(#link_batches[1], 2, "the first page links both of its files together")
assertEqual(#link_batches[2], 1, "the second page links its file")
assertEqual(link_batches[1][1].bookFileId, 101, "links carry the manifest file id")
assertEqual(checkpoint_store.record, nil, "a completed run clears its checkpoint")
assertEqual(allow_calls > 0, true, "completion releases standby")
assertEqual(applied_library_versions[1], "lib-v1",
    "the manifest token feeds the shared library-version invalidation path")

-- The manifest filter is sent without the interactive listing's paging and
-- sort inputs, which the endpoint rejects.
resetRun()
local seen_params
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        seen_params = params
        return { items = {}, hasNext = false, manifestVersion = "lib-v1" }
    end,
}
Catalog:startBulkSource{
    kind = "filter",
    label = "Filtered",
    total = 1,
    params = { sort = "title", order = "asc", q = "dune", readStatus = "reading", page = 3 },
}
drain()
assertEqual(seen_params.q, "dune", "manifest keeps the filter")
assertEqual(seen_params.readStatus, "reading", "manifest keeps the read status filter")
assertEqual(seen_params.sort, nil, "manifest drops the listing sort")
assertEqual(seen_params.order, nil, "manifest drops the listing order")
assertEqual(seen_params.page, nil, "manifest drops the listing page")
assertEqual(seen_params.size, 100, "manifest requests a bounded page")

-- Resuming from a checkpoint validates an already-published file against the
-- manifest size and hash instead of transferring it again.
resetRun()
files["/downloads/Books/Book1.epub"] = { size = 1001 }
hashes["/downloads/Books/Book1.epub"] = "hash1001"
checkpoint_store.record = {
    source_key = "filter|sort=title",
    cursor = "cursor-2",
    manifest_version = "lib-v1",
    completed = { ["1"] = "/downloads/Books/Book1.epub" },
    counts = { downloaded = 4 },
    failures = {},
    processed = 4,
}
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        assertEqual(params.cursor, "cursor-2", "a resumed run continues from the committed cursor")
        return {
            items = { manifestBook(1, "hash1001"), manifestBook(2, "hash1002") },
            hasNext = false,
            manifestVersion = "lib-v1",
        }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "All", total = 6, params = { sort = "title" } }
drain()
assertEqual(#transfers, 1, "a validated published file is not transferred again")
assertEqual(transfers[1], "/downloads/Books/Book2.epub", "only the unfinished book transfers")
assertEqual(#link_batches, 1, "the resumed run still links in one batch")
assertEqual(#link_batches[1], 2, "the validated file is linked alongside the new one")
files["/downloads/Books/Book1.epub"] = nil
files["/downloads/Books/Book2.epub"] = nil

-- An interruption in the middle of a page commits the cursor of that same
-- page, so the resumed run cannot skip the books it had not reached yet.
resetRun()
checkpoint_store.record = {
    source_key = "filter|sort=title",
    cursor = "cursor-A",
    manifest_version = "lib-v1",
    completed = {},
    counts = {},
    failures = {},
}
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function()
        return {
            items = { manifestBook(1, "hash1001"), manifestBook(2, "hash1002") },
            hasNext = true,
            nextCursor = "cursor-B",
            manifestVersion = "lib-v1",
        }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "All", total = 4, params = { sort = "title" } }
-- Run only the preparation and the first book, then stop the run.
local guard = 0
while Catalog.bulk_ctx and (Catalog.bulk_ctx.index or 0) < 1 do
    guard = guard + 1
    if guard > 20 then error("first book never started") end
    table.remove(scheduled, 1)()
end
Catalog.bulk_ctx.cancel_requested = true
drain()
assertEqual(checkpoint_store.record ~= nil, true, "an interrupted run keeps a checkpoint")
assertEqual(checkpoint_store.record.cursor, "cursor-A", "the checkpoint keeps the cursor of the unfinished page")
assertEqual(checkpoint_store.record.completed["1"], "/downloads/Books/Book1.epub", "the finished destination is recorded")
assertEqual(checkpoint_store.record.completed["2"], nil, "an unreached book is not recorded as complete")

-- A stale checkpoint from another source never resumes into the wrong run.
resetRun()
checkpoint_store.record = { source_key = "filter|sort=author", cursor = "other", completed = {} }
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        assertEqual(params.cursor, nil, "a mismatched checkpoint restarts enumeration")
        return { items = {}, hasNext = false, manifestVersion = "lib-v1" }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "All", total = 1, params = { sort = "title" } }
drain()
assertEqual(checkpoint_store.cleared > 0, true, "a mismatched checkpoint is discarded")

-- A changed manifest snapshot restarts enumeration rather than silently
-- skipping or duplicating entries.
resetRun()
local restart_served = false
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        if params.cursor and not restart_served then
            restart_served = true
            return { items = {}, hasNext = false, manifestVersion = "lib-v2", restartRequired = true }
        end
        if restart_served then
            return { items = { manifestBook(9, "hash1009") }, hasNext = false, manifestVersion = "lib-v2" }
        end
        return {
            items = { manifestBook(1, "hash1001") },
            hasNext = true,
            nextCursor = "cursor-2",
            manifestVersion = "lib-v1",
        }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "All", total = 2, params = { sort = "title" } }
drain()
assertEqual(restart_served, true, "the server reported the snapshot change")
assertEqual(transfers[#transfers], "/downloads/Books/Book9.epub", "enumeration continues after the restart")

-- Without the advertised capability the run keeps paged catalog enumeration
-- and bounded per-book detail calls instead of loading the whole result set.
resetRun()
Catalog.client = makeClient{
    capabilities = {},
    manifest = function()
        error("manifest must not be requested on a server without the capability")
    end,
    books = function(params)
        assertEqual(params.size, 100, "legacy enumeration stays page-at-a-time")
        if params.page == 1 then
            return { items = { { id = 5, title = "Legacy", formats = { "epub" } } }, hasNext = false }
        end
        return { items = {}, hasNext = false }
    end,
    detail = function(id)
        return {
            id = id,
            title = "Legacy",
            files = { { id = 500, format = "epub", sizeBytes = 42, devicePath = "Books/Legacy.epub" } },
        }
    end,
    match = function()
        return { matches = { { hash = "hash42", bookId = 5, bookFileId = 500 } } }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "Legacy", total = 1, params = {} }
drain()
assertEqual(calls.manifest, 0, "an unsupported server is never asked for a manifest")
assertEqual(calls.books, 1, "legacy enumeration uses the paged catalog listing")
assertEqual(calls.detail, 1, "legacy enumeration resolves file descriptors per book")
assertEqual(calls.match, 1, "a download without a manifest hash falls back to a match check")
assertEqual(#link_batches, 1, "the match result is linked in one batch")

-- A transient version-check failure must not park the plugin on the legacy
-- path for the rest of the session.
Capabilities.reset()
local transient_client = makeClient{ version_error = 503 }
assertEqual(Capabilities.supports(transient_client, "catalogBulkManifest"), nil, "a 5xx leaves support unknown")
assertEqual(Capabilities.cached(transient_client), nil, "a transient failure is not cached")
local recovered = makeClient{ capabilities = { "catalogBulkManifest" } }
assertEqual(Capabilities.supports(recovered, "catalogBulkManifest"), true, "support is re-checked after recovery")

-- Enumeration follows cursors past the old 20,000 book ceiling.
resetRun()
Catalog.isOnDevice = function() return true end
local large_pages = 210
Catalog.client = makeClient{
    capabilities = { "catalogBulkManifest" },
    manifest = function(params)
        local page = tonumber(params.cursor) or 1
        local items = {}
        for index = 1, 100 do
            table.insert(items, manifestBook((page - 1) * 100 + index, "hash"))
        end
        return {
            items = items,
            hasNext = page < large_pages,
            nextCursor = page < large_pages and tostring(page + 1) or nil,
            manifestVersion = "lib-v1",
        }
    end,
}
Catalog:startBulkSource{ kind = "filter", label = "Everything", total = large_pages * 100, params = { sort = "title" } }
drain(large_pages * 100 + large_pages + 100)
assertEqual(Catalog.bulk_ctx, nil, "the large run completes")
assertEqual(calls.manifest, large_pages, "every cursor page is requested")
assertEqual(shown_widget.title:find("Skipped on device: 21000", 1, true) ~= nil, true, "the run processed 21000 books")
Catalog.isOnDevice = function() return false end

-- Cancelling stops before the next book starts.
resetRun()
Catalog.client = makeClient{ capabilities = { "catalogBulkManifest" }, manifest = function() return { items = {} } end }
local processed = {}
local cancel_ctx = {
    page = { { id = 1 }, { id = 2 } },
    page_position = 0,
    index = 0,
    total = 2,
    cancel_requested = false,
    cancelled = false,
    counts = { downloaded = 0, linked = 0, skipped_on_device = 0, skipped_unsupported = 0, skipped_existing = 0, path_conflicts = 0, failed = 0 },
    pending_links = {},
    pending_matches = {},
    completed = {},
    failed_books = {},
    failed_titles = {},
    checkpoint = fake_checkpoint,
}
Catalog.bulk_running = true
Catalog.bulk_ctx = cancel_ctx
local realBulkProcessBook = Catalog.bulkProcessBook
Catalog.bulkProcessBook = function(_, _, book)
    table.insert(processed, book.id)
end
Catalog:bulkQueueStep(cancel_ctx)
assertEqual(#processed, 1, "first queue step processes one book")
assertEqual(#scheduled, 1, "next item waits for a UI event window")
cancel_ctx.cancel_requested = true
table.remove(scheduled, 1)()
assertEqual(#processed, 1, "cancel prevents the second book from starting")
assertEqual(cancel_ctx.cancelled, true, "cancel marks the run as stopped")
assertEqual(Catalog.bulk_running, false, "cancel finishes the bulk run")
assertEqual(checkpoint_store.record ~= nil, true, "a cancelled run keeps its checkpoint for resume")
Catalog.bulkProcessBook = realBulkProcessBook

-- Two books whose device paths collide publish to distinct destinations.
resetRun()
Catalog.client = makeClient{ capabilities = { "catalogBulkManifest" }, manifest = function() return { items = {} } end }
transfer_result_hash = function() return nil end
local collision_ctx = {
    index = 1,
    counts = { downloaded = 0, linked = 0, skipped_on_device = 0, skipped_unsupported = 0, skipped_existing = 0, path_conflicts = 0, failed = 0 },
    destination_paths = {},
    path_conflicts = {},
    existing_files = {},
    failed_books = {},
    failed_titles = {},
    pending_links = {},
    pending_matches = {},
    completed = {},
}
local function collisionBook(id, title)
    return {
        id = id,
        title = title,
        formats = { "epub" },
        files = { { id = 100 + id, format = "epub", devicePath = "Shared/Book.epub" } },
    }
end
Catalog.bulkShowStatus = function() end
Catalog.bulkDownloadFile = function(_, _, _, _, local_path)
    table.insert(transfers, local_path)
    return true
end
Catalog:bulkProcessBook(collision_ctx, collisionBook(1, "First"))
collision_ctx.index = 2
Catalog:bulkProcessBook(collision_ctx, collisionBook(2, "Second"))
collision_ctx.index = 3
Catalog:bulkProcessBook(collision_ctx, collisionBook(3, "Third"))

assertEqual(transfers[1], "/downloads/Shared/Book.epub", "first collision path remains unchanged")
assertEqual(transfers[2], "/downloads/Shared/Book [2].epub", "second collision path gains book identity")
assertEqual(transfers[3], "/downloads/Shared/Book [3].epub", "third collision path gains book identity")
assertEqual(collision_ctx.counts.downloaded, 3, "all colliding books download")
assertEqual(collision_ctx.counts.path_conflicts, 2, "collision count recorded")
assertEqual(collision_ctx.path_conflicts[1].conflicting_book_id, 1, "collision owner recorded")
assertEqual(collision_ctx.path_conflicts[1].resolved_path, "/downloads/Shared/Book [2].epub", "resolved collision path recorded")
assertEqual(collision_ctx.destination_paths["/downloads/shared/book.epub"].book_id, 1, "original path ownership retained")
assertEqual(collision_ctx.completed["2"], "/downloads/Shared/Book [2].epub", "checkpoint records the renamed destination")

Catalog.bulkReleaseStandby = function() end
Catalog:bulkFinish(collision_ctx)
assertEqual(shown_widget.title:find("Renamed path conflicts: 2", 1, true) ~= nil, true, "completion summary keeps conflict count")
assertEqual(shown_widget.title:find("Conflicting destinations were renamed with BookOrbit IDs.", 1, true) ~= nil, true, "completion summary explains renaming")
assertEqual(shown_widget.title:find(" -> ", 1, true), nil, "completion summary omits long path mappings")

print("bookorbit_catalog_bulk_download_test.lua: ok")
