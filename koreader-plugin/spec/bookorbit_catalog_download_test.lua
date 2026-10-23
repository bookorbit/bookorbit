local shown_widget
local typed_filename
local made_paths = {}
local scheduled = {}

local function identity(value)
    return value
end

package.loaded["ui/bidi"] = {
    dirpath = identity,
    filepath = identity,
}
package.loaded["ui/widget/buttondialog"] = {
    new = function(_, opts)
        function opts:setTitle(title)
            self.title = title
        end
        return opts
    end,
}
package.loaded["ui/widget/inputdialog"] = {
    new = function(_, opts)
        function opts:getInputText()
            return typed_filename or self.input
        end
        function opts:onShowKeyboard() end
        return opts
    end,
}
package.loaded["ui/widget/confirmbox"] = package.loaded["ui/widget/buttondialog"]
package.loaded["ui/widget/infomessage"] = package.loaded["ui/widget/buttondialog"]
package.loaded["ui/widget/notification"] = package.loaded["ui/widget/buttondialog"]
package.loaded["ui/uimanager"] = {
    show = function(_, widget)
        shown_widget = widget
    end,
    close = function() end,
    nextTick = function(_, callback)
        table.insert(scheduled, callback)
    end,
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
package.loaded["util"] = {
    makePath = function(path)
        table.insert(made_paths, path)
    end,
    getSafeFilename = function(filename, path)
        if path and path:match("^/mnt/") then
            return filename:gsub("[\\/:*?\"<>|]", "_")
        end
        return filename
    end,
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_state"] = {}
package.loaded["gettext"] = identity
package.loaded["bookorbit_catalog_util"] = {
    formatBytes = tostring,
    safeFilenameBase = function(detail)
        return detail.fallbackFilename
    end,
}

-- The download sheet and the status pills are drawn elsewhere; here they
-- only record what the catalog asked of them.
local sheet_opens = {}
local sheet_reports = {}
local toasts = {}
package.loaded["bookorbit_download_sheet"] = {
    open = function(catalog, opened_detail, opts)
        local page = { catalog = catalog, detail = opened_detail, opts = opts or {} }
        table.insert(sheet_opens, page)
        return page
    end,
    reporter = function(page)
        return {
            progress = function(received, total) table.insert(sheet_reports, { kind = "progress", received = received, total = total }) end,
            finished = function(ok, err, path, linked) table.insert(sheet_reports, { kind = "finished", ok = ok, err = err, path = path, linked = linked }) end,
        }
    end,
}
package.loaded["bookorbit_toast"] = {
    show = function(text) table.insert(toasts, { kind = "show", text = text }) end,
    error = function(text, retry) table.insert(toasts, { kind = "error", text = text, retry = retry }) end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDownload = require("bookorbit_catalog_download")
local Catalog = {}
CatalogDownload.install(Catalog)

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertContains(value, expected, label)
    if not value:find(expected, 1, true) then
        error(string.format("%s: expected %q in %q", label, expected, value))
    end
end

local download_dir = "/mnt/onboard/library"
local saved_download_dir
G_reader_settings = {
    readSetting = function(_, key)
        if key == "download_dir" then return download_dir end
        return nil
    end,
    saveSetting = function(_, key, value)
        if key == "download_dir" then download_dir = value end
    end,
    flush = function() saved_download_dir = download_dir end,
}

local detail = {
    id = 1,
    title = "Annihilation",
    fallbackFilename = "Annihilation - Jeff VanderMeer",
}
local file = {
    id = 10,
    format = "epub",
    devicePath = "Series/Southern Reach/1.00 - Annihilation.epub",
}

local folder, filename = Catalog:getLocalDownloadPreview(detail.fallbackFilename, file.format, file.devicePath, false)
assertEqual(folder, "/mnt/onboard/library/Series/Southern Reach", "configured preview folder")
assertEqual(filename, "1.00 - Annihilation", "configured preview filename")
assertEqual(#made_paths, 0, "preview does not create directories")

local resolved = Catalog:getLocalDownloadPath(detail.fallbackFilename, file.format, file.devicePath)
assertEqual(resolved, "/mnt/onboard/library/Series/Southern Reach/1.00 - Annihilation.epub", "configured destination")
assertEqual(made_paths[1], "/mnt/onboard/library/Series/Southern Reach", "configured parent created")

made_paths = {}
resolved = Catalog:getLocalDownloadPath(
    "Bret Easton Ellis - The Shards: A Novel",
    "epub",
    "Standalone/Bret Easton Ellis - The Shards: A Novel.epub"
)
assertEqual(resolved, "/mnt/onboard/library/Standalone/Bret Easton Ellis - The Shards_ A Novel.epub", "device filename is filesystem safe")
assertEqual(made_paths[1], "/mnt/onboard/library/Standalone", "sanitized filename keeps configured parent")

made_paths = {}
resolved = Catalog:getLocalDownloadPath("Fallback", "epub", "Series: One/Book? One.epub")
assertEqual(resolved, "/mnt/onboard/library/Series_ One/Book_ One.epub", "every device path segment is filesystem safe")
assertEqual(made_paths[1], "/mnt/onboard/library/Series_ One", "sanitized device parent is created")

download_dir = "/library"
made_paths = {}
resolved = Catalog:getLocalDownloadPath("Fallback", "epub", "Standalone/Book: One.epub")
assertEqual(resolved, "/library/Standalone/Book: One.epub", "permissive filesystem keeps supported characters")
assertEqual(made_paths[1], "/library/Standalone", "permissive filesystem keeps configured parent")
download_dir = "/mnt/onboard/library"

made_paths = {}
resolved = Catalog:getLocalDownloadPath("Preferred/Name", "EPUB", file.devicePath, true)
assertEqual(resolved, "/mnt/onboard/library/Series/Southern Reach/Preferred_Name.epub", "filename override preserves configured folder")
assertEqual(made_paths[1], "/mnt/onboard/library/Series/Southern Reach", "override parent created")

made_paths = {}
resolved = Catalog:getLocalDownloadPath("Fallback", "epub", "../outside.epub")
assertEqual(resolved, "/mnt/onboard/library/Fallback.epub", "unsafe device path falls back inside download folder")
assertEqual(#made_paths, 0, "unsafe device path does not create directories")

resolved = Catalog:getLocalDownloadPath("Fallback", "epub", "./Series//Book.epub")
assertEqual(resolved, "/mnt/onboard/library/Series/Book.epub", "device path normalization remains unchanged")

download_dir = "/"
folder, filename = Catalog:getLocalDownloadPreview("Fallback", "epub", "Book.epub", false)
assertEqual(folder, "/", "root preview folder")
assertEqual(filename, "Book", "root preview filename")
assertEqual(Catalog:getLocalDownloadPath("Fallback", "epub", "Book.epub"), "/Book.epub", "root destination")
download_dir = "/mnt/onboard/library"
made_paths = {}

-- The dialogs are one sheet now: every way in opens it with what it knows.
Catalog:showDownloadDialog(detail, file, "Custom Name")
assertEqual(#sheet_opens, 1, "the download dialog is the download sheet")
assertEqual(sheet_opens[1].opts.file, file, "the sheet starts on the chosen file")
assertEqual(sheet_opens[1].opts.filename, "Custom Name", "a name already chosen carries into the sheet")
Catalog:showDownloadOptions(detail)
assertEqual(#sheet_opens, 2, "download options open the same sheet")
Catalog:changeDownloadVariant(detail, { id = 10, downloadVariant = "audioless_epub" })
assertEqual(sheet_opens[3].opts.variant, "original", "switching a read-along EPUB asks for its other form")

-- A file already at the path opens the sheet, which warns before replacing.
local downloaded_path
Catalog.downloadFile = function(_, path) downloaded_path = path end
package.loaded["libs/libkoreader-lfs"].attributes = function() return "file" end
Catalog:checkDownloadFile("/mnt/onboard/library/Exists.epub", detail, file)
assertEqual(#sheet_opens, 4, "an existing file is not overwritten without the sheet")
assertEqual(downloaded_path, nil, "nothing downloads before the sheet is confirmed")
package.loaded["libs/libkoreader-lfs"].attributes = function() return nil end
Catalog:checkDownloadFile("/mnt/onboard/library/New.epub", detail, file)
table.remove(scheduled, 1)()
assertEqual(downloaded_path, "/mnt/onboard/library/New.epub", "a new file downloads straight away")
Catalog.downloadFile = nil
CatalogDownload.install(Catalog)

-- Cancelling a transfer bumps the generation, so a child that finishes late
-- cannot publish and its progress cannot resurrect the dismissed sheet.
local transfer_opts
package.loaded["bookorbit_download_transfer"].sweepStale = function() return 0 end
package.loaded["bookorbit_download_transfer"].run = function(opts)
    transfer_opts = opts
    return nil, "cancelled"
end
Catalog.runOffThread = function(_, fn) return fn() end
Catalog.client = {
    downloadCatalogFile = function() return true end,
}
Catalog.showRetry = function()
    error("a cancelled download must not offer a retry")
end
Catalog.linkDownloadedFile = function() return false end

sheet_opens, sheet_reports = {}, {}
Catalog:downloadFile("/mnt/onboard/library/Cancelled.epub", detail, { id = 9, sizeBytes = 100 })
assertEqual(#sheet_opens, 1, "a download started away from its page opens the sheet")
assertEqual(sheet_opens[1].opts.progress, true, "the sheet opens showing the download")
assertEqual(transfer_opts.is_current(), true, "an uncancelled transfer stays publishable")
assertEqual(sheet_reports[#sheet_reports].err, "cancelled", "the sheet hears that it was cancelled")

local generation_before = Catalog.download_generation
sheet_reports = {}
package.loaded["bookorbit_download_transfer"].run = function(opts)
    transfer_opts = opts
    opts.on_progress(50)
    -- The user taps Cancel while the child is still transferring.
    Catalog:nextDownloadGeneration()
    opts.on_progress(90)
    return nil, "cancelled"
end
Catalog:downloadFile("/mnt/onboard/library/Cancelled.epub", detail, { id = 9, sizeBytes = 100 })
assertEqual(Catalog.download_generation > generation_before, true, "cancelling advances the download generation")
assertEqual(transfer_opts.is_current(), false, "a late child result is refused after cancellation")
local progress_after_cancel = 0
for _i, r in ipairs(sheet_reports) do if r.kind == "progress" and r.received == 90 then progress_after_cancel = progress_after_cancel + 1 end end
assertEqual(progress_after_cancel, 0, "late progress does not reach the dismissed sheet")

-- A finished download tells the sheet where it went and whether it linked.
sheet_reports = {}
package.loaded["bookorbit_download_transfer"].run = function() return true end
Catalog.settings = {}
Catalog:downloadFile("/mnt/onboard/library/Done.epub", detail, { id = 9, sizeBytes = 100 })
local done = sheet_reports[#sheet_reports]
assertEqual(done.ok, true, "a finished download reports success")
assertEqual(done.path, "/mnt/onboard/library/Done.epub", "and where the file went")
assertEqual(done.linked, false, "and that the link failed, so the sheet can say so")

-- Started from the book's own page, the page's button shows it; an expired
-- selection (409) offers Retry, which asks the server for a fresh one.
local retry
local refreshed = { id = detail.id, files = { { id = 10, selection = "fresh", downloadVariant = "original" } } }
local refresh_error
local expected_variant = "original"
local write_error
Catalog.detailShowDownloadProgress = function() return true end
package.loaded["bookorbit_download_transfer"].run = function() return nil, 409 end
Catalog.showRetry = function(_, err, callback)
    assertEqual(err, 409, "expired selection offers retry")
    retry = callback
end
Catalog.runConnected = function(_, callback) return callback() end
Catalog.fetchDeliveryBook = function(_, id, variant)
    assertEqual(id, detail.id, "retry refreshes the same book")
    assertEqual(variant, expected_variant, "retry preserves requested policy")
    return refreshed, refresh_error
end
Catalog.showWriteError = function(_, err) write_error = err end
local refreshed_view
Catalog.current_context = { detail = detail }
Catalog.refreshDetailView = function() refreshed_view = true end
local retry_file
Catalog.checkDownloadFile = function(_, destination, selected, candidate)
    assertEqual(destination, "/mnt/onboard/library/Chosen.epub", "retry preserves chosen destination")
    assertEqual(selected, refreshed, "retry uses refreshed detail")
    retry_file = candidate
end
local stale = { id = 10, selection = "stale", requestedVariant = "original", downloadVariant = "original" }
sheet_opens = {}
Catalog:downloadFile("/mnt/onboard/library/Chosen.epub", detail, stale)
assertEqual(#sheet_opens, 0, "a download on the book's own page opens no sheet")
retry()
assertEqual(retry_file.selection, "fresh", "retry replaces stale selection")
assertEqual(refreshed_view, true, "retry refreshes current detail view")
assertEqual(Catalog.current_context.detail, refreshed, "retry retains refreshed metadata")

expected_variant = "audioless_epub"
stale.requestedVariant = "audioless_epub"
retry()
assertEqual(retry_file.selection, "fresh", "plain original bytes retain the requested text-only policy")

retry_file = nil
refreshed = { id = detail.id, files = { { id = 11 } } }
retry()
assertEqual(write_error, 404, "removed file reports unavailable")
assertEqual(retry_file, nil, "removed file never downloads another candidate")
refreshed, refresh_error, write_error = nil, "cancelled", nil
retry()
assertEqual(write_error, nil, "cancelled refresh remains quiet")
refresh_error = 401
retry()
assertEqual(write_error, 401, "failed refresh reports actual error")
Catalog.detailShowDownloadProgress = nil

local catalog_closed, reader_opened, redrawn = false, false, false
Catalog.close_callback = function() catalog_closed = true end
Catalog.updateItems = function() redrawn = true end
Catalog._manager = { ui = { openFile = function() reader_opened = true end } }
toasts = {}
Catalog:openDownloadedFile("/path/to/library/missing.epub")
assertEqual(catalog_closed, false, "a file removed after rendering does not close the catalog")
assertEqual(reader_opened, false, "a missing file is never handed to the reader")
assertEqual(redrawn, true, "missing-file availability is redrawn")
assertContains(toasts[1].text, "not on this device", "missing-file feedback explains recovery")
package.loaded["libs/libkoreader-lfs"].attributes = function() return "directory" end
Catalog:openDownloadedFile("/path/to/library/directory.epub")
assertEqual(reader_opened, false, "a directory is not handed to the reader")
package.loaded["libs/libkoreader-lfs"].attributes = function() return "file" end
Catalog:openDownloadedFile("/path/to/library/restored.epub")
assertEqual(catalog_closed, true, "a restored file follows the normal close path")
assertEqual(reader_opened, true, "a restored file opens normally")

print("bookorbit_catalog_download_test.lua: ok")
