local scheduled = {}
local prevent_calls = 0
local allow_calls = 0
local shown_widget

package.loaded["ui/bidi"] = {}
package.loaded["datastorage"] = {
    getDataDir = function()
        return "/tmp"
    end,
}
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
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function()
        return nil
    end,
}
package.loaded["logger"] = {
    dbg = function() end,
    warn = function() end,
}
package.loaded["ffi/util"] = {
    template = function(text)
        return text
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
}
package.loaded["bookorbit_state"] = {}
package.loaded["gettext"] = function(text)
    return text
end
package.loaded["bookorbit_catalog_util"] = {
    cloneParams = function(value)
        return value or {}
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

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BulkDownload = require("bookorbit_catalog_bulk_download")
local CatalogDownload = require("bookorbit_catalog_download")
local Catalog = {}
BulkDownload.install(Catalog)
CatalogDownload.install(Catalog)
local realBulkProcessBook = Catalog.bulkProcessBook

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
Catalog:startBulkSource{
    label = "Empty",
    resolve = function()
        return {}
    end,
}
assertEqual(prevent_calls, 1, "starting a bulk download prevents standby")
assertEqual(allow_calls, 0, "standby remains prevented while preparation is queued")
assertEqual(#scheduled, 1, "preparation is scheduled")

table.remove(scheduled, 1)()
assertEqual(allow_calls, 1, "empty-source abort releases standby")
assertEqual(Catalog.bulk_running, false, "empty-source abort clears running state")

local finish_ctx = {
    standby_prevented = true,
    counts = {
        downloaded = 0,
        linked = 0,
        skipped_on_device = 0,
        skipped_unsupported = 0,
        skipped_existing = 0,
        failed = 0,
    },
    failed_books = {},
    failed_titles = {},
    cancelled = false,
}
prevent_calls = prevent_calls + 1
Catalog.bulk_running = true
Catalog.bulk_ctx = finish_ctx
Catalog.refreshOnDevice = function() end
Catalog.bookMode = function() return false end
Catalog.dashboardMode = function() return false end
Catalog:bulkFinish(finish_ctx)
assertEqual(allow_calls, 2, "normal completion releases standby")
assertEqual(finish_ctx.standby_prevented, false, "completion marks standby lock released")

Catalog:bulkReleaseStandby(finish_ctx)
assertEqual(allow_calls, 2, "standby release is idempotent")

local processed = {}
local cancel_ctx = {
    books = { { id = 1 }, { id = 2 } },
    index = 0,
    total = 2,
    cancel_requested = false,
    cancelled = false,
    counts = {
        downloaded = 0,
        linked = 0,
        skipped_on_device = 0,
        skipped_unsupported = 0,
        skipped_existing = 0,
        path_conflicts = 0,
        failed = 0,
    },
    failed_books = {},
    failed_titles = {},
}
Catalog.bulk_running = true
Catalog.bulk_ctx = cancel_ctx
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

Catalog.bulkProcessBook = realBulkProcessBook
local collision_ctx = {
    index = 1,
    counts = {
        downloaded = 0,
        linked = 0,
        skipped_on_device = 0,
        skipped_unsupported = 0,
        skipped_existing = 0,
        path_conflicts = 0,
        failed = 0,
    },
    destination_paths = {},
    path_conflicts = {},
    existing_files = {},
    failed_books = {},
    failed_titles = {},
}
local details = {
    [1] = { title = "First", files = { { id = 101, format = "epub", devicePath = "Shared/Book.epub" } } },
    [2] = { title = "Second", files = { { id = 102, format = "epub", devicePath = "Shared/Book.epub" } } },
    [3] = { title = "Third", files = { { id = 103, format = "epub", devicePath = "Shared/Book.epub" } } },
}
local downloaded_paths = {}
Catalog.isOnDevice = function() return false end
Catalog.bulkSupportedFormatHint = function() return true end
Catalog.client = {
    catalogBook = function(_, id)
        return details[id]
    end,
}
Catalog.bulkChooseFile = function(_, detail)
    return detail.files[1]
end
Catalog.bulkExistingPolicy = function()
    return { id = "skip" }
end
Catalog.bulkDownloadFile = function(_, _, _, _, local_path)
    table.insert(downloaded_paths, local_path)
    return true, false
end
Catalog.bulkShowStatus = function() end

Catalog:bulkProcessBook(collision_ctx, { id = 1, title = "First" })
collision_ctx.index = 2
Catalog:bulkProcessBook(collision_ctx, { id = 2, title = "Second" })
collision_ctx.index = 3
Catalog:bulkProcessBook(collision_ctx, { id = 3, title = "Third" })

assertEqual(downloaded_paths[1], "/downloads/Shared/Book.epub", "first collision path remains unchanged")
assertEqual(downloaded_paths[2], "/downloads/Shared/Book [2].epub", "second collision path gains book identity")
assertEqual(downloaded_paths[3], "/downloads/Shared/Book [3].epub", "third collision path gains book identity")
assertEqual(collision_ctx.counts.downloaded, 3, "all colliding books download")
assertEqual(collision_ctx.counts.path_conflicts, 2, "collision count recorded")
assertEqual(#collision_ctx.path_conflicts, 2, "collision details recorded")
assertEqual(collision_ctx.path_conflicts[1].conflicting_book_id, 1, "collision owner recorded")
assertEqual(collision_ctx.path_conflicts[1].resolved_path, "/downloads/Shared/Book [2].epub", "resolved collision path recorded")
assertEqual(collision_ctx.destination_paths["/downloads/shared/book.epub"].book_id, 1, "original path ownership retained")
assertEqual(collision_ctx.destination_paths["/downloads/shared/book [2].epub"].book_id, 2, "second renamed path ownership recorded")
assertEqual(collision_ctx.destination_paths["/downloads/shared/book [3].epub"].book_id, 3, "third renamed path ownership recorded")

Catalog.bulkReleaseStandby = function() end
Catalog.refreshOnDevice = function() end
Catalog.bookMode = function() return false end
Catalog.dashboardMode = function() return false end
Catalog:bulkFinish(collision_ctx)
assertEqual(shown_widget.title:find("Renamed path conflicts: 2", 1, true) ~= nil, true, "completion summary keeps conflict count")
assertEqual(shown_widget.title:find("Conflicting destinations were renamed with BookOrbit IDs.", 1, true) ~= nil, true, "completion summary explains renaming")
assertEqual(shown_widget.title:find(" -> ", 1, true), nil, "completion summary omits long path mappings")

print("bookorbit_catalog_bulk_download_test.lua: ok")
