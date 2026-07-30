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
    getSafeFilename = function(filename)
        return filename:gsub("[\\/:*?\"<>|]", "_")
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
G_reader_settings = {
    readSetting = function(_, key)
        if key == "download_dir" then return download_dir end
        return nil
    end,
    saveSetting = function(_, key, value)
        if key == "download_dir" then download_dir = value end
    end,
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

local downloaded_path
Catalog.checkDownloadFile = function(_, path)
    downloaded_path = path
end

Catalog:showDownloadDialog(detail, file)
local dialog = shown_widget
assertContains(dialog.title, "Download folder:\n/mnt/onboard/library/Series/Southern Reach", "dialog shows resolved folder")
assertContains(dialog.title, "Download filename:\n1.00 - Annihilation", "dialog shows resolved filename")
assertEqual(#made_paths, 0, "opening dialog does not create directories")
dialog.buttons[1][1].callback()
assertEqual(downloaded_path, "/mnt/onboard/library/Series/Southern Reach/1.00 - Annihilation.epub", "dialog downloads previewed destination")

downloaded_path = nil
Catalog:showDownloadDialog(detail, file)
dialog = shown_widget
dialog.buttons[3][2].callback()
local input_dialog = shown_widget
assertEqual(input_dialog.input, "1.00 - Annihilation", "filename editor starts with resolved filename")
typed_filename = " Preferred/Name "
input_dialog.buttons[1][2].callback()
assertContains(dialog.title, "Download folder:\n/mnt/onboard/library/Series/Southern Reach", "override keeps resolved folder in dialog")
assertContains(dialog.title, "Download filename:\nPreferred_Name", "dialog previews sanitized override")
dialog.buttons[1][1].callback()
assertEqual(downloaded_path, "/mnt/onboard/library/Series/Southern Reach/Preferred_Name.epub", "filename editor changes downloaded filename")
typed_filename = nil

file.devicePath = nil
Catalog:showDownloadDialog(detail, file)
dialog = shown_widget
assertContains(dialog.title, "Download folder:\n/mnt/onboard/library", "legacy dialog keeps base folder")
assertContains(dialog.title, "Download filename:\nAnnihilation - Jeff VanderMeer", "legacy dialog keeps fallback filename")
dialog.buttons[1][1].callback()
assertEqual(downloaded_path, "/mnt/onboard/library/Annihilation - Jeff VanderMeer.epub", "legacy download remains unchanged")

file.devicePath = "Series/Southern Reach/1.00 - Annihilation.epub"
package.loaded["ui/downloadmgr"] = {
    new = function(_, opts)
        function opts:chooseDir()
            self.onConfirm("/mnt/onboard/books")
        end
        return opts
    end,
}
Catalog:showDownloadDialog(detail, file)
dialog = shown_widget
dialog.buttons[3][2].callback()
input_dialog = shown_widget
typed_filename = "Custom Name"
input_dialog.buttons[1][2].callback()
dialog.buttons[3][1].callback()
assertEqual(#scheduled, 1, "folder change queues refreshed dialog")
table.remove(scheduled, 1)()
dialog = shown_widget
assertContains(dialog.title, "Download folder:\n/mnt/onboard/books/Series/Southern Reach", "folder change refreshes resolved folder")
assertContains(dialog.title, "Download filename:\nCustom Name", "folder change preserves filename override")
dialog.buttons[1][1].callback()
assertEqual(downloaded_path, "/mnt/onboard/books/Series/Southern Reach/Custom Name.epub", "combined folder and filename changes match preview")

-- Cancelling a transfer bumps the generation, so a child that finishes late
-- cannot publish and its progress cannot resurrect the dismissed dialog.
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

shown_widget = nil
Catalog:downloadFile("/mnt/onboard/library/Cancelled.epub", detail, { id = 9, sizeBytes = 100 })
assertContains(shown_widget.title, "Downloading:\nCancelled.epub", "the transfer shows a progress dialog")
assertEqual(transfer_opts.is_current(), true, "an uncancelled transfer stays publishable")

local generation_before = Catalog.download_generation
package.loaded["bookorbit_download_transfer"].run = function(opts)
    transfer_opts = opts
    opts.on_progress(50)
    -- The user taps cancel while the child is still transferring.
    shown_widget.buttons[1][1].callback()
    opts.on_progress(90)
    return nil, "cancelled"
end
Catalog:downloadFile("/mnt/onboard/library/Cancelled.epub", detail, { id = 9, sizeBytes = 100 })
assertEqual(Catalog.download_generation > generation_before, true, "cancelling advances the download generation")
assertEqual(transfer_opts.is_current(), false, "a late child result is refused after cancellation")
assertEqual(shown_widget.text, "Download cancelled.", "the dismissed dialog is not resurrected by late progress")

print("bookorbit_catalog_download_test.lua: ok")
