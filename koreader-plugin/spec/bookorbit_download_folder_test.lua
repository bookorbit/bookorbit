-- Single and bulk downloads write to one destination, KOReader's own
-- download_dir, so both dialogs have to offer the same chooser and see each
-- other's choice. The bulk popup previously only reported the folder in its
-- confirmation text, which left the setting reachable from the single-book
-- dialog alone.

local shown = {}
local next_ticks = {}

package.loaded["ui/bidi"] = {
    dirpath = function(value) return value end,
    filepath = function(value) return value end,
}
package.loaded["datastorage"] = {
    getSettingsDir = function() return "/tmp/bookorbit-spec" end,
    getDataDir = function() return "/tmp/bookorbit-spec" end,
}
package.loaded["dump"] = function(value) return tostring(value) end
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["ui/widget/buttondialog"] = {
    new = function(_, opts)
        opts = opts or {}
        function opts:setTitle(title) self.title = title end
        return opts
    end,
}
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts or {} end }
package.loaded["ui/widget/confirmbox"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/widget/inputdialog"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/widget/notification"] = package.loaded["ui/widget/infomessage"]
package.loaded["ui/uimanager"] = {
    show = function(_, widget) table.insert(shown, widget) end,
    close = function() end,
    nextTick = function(_, callback) table.insert(next_ticks, callback) end,
    scheduleIn = function(_, _, callback) table.insert(next_ticks, callback) end,
    preventStandby = function() end,
    allowStandby = function() end,
    forceRePaint = function() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
    dir = function() return function() return nil end end,
}
package.loaded["logger"] = { dbg = function() end, warn = function() end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    getSafeFilename = function(value) return value end,
    makePath = function() end,
    trim = function(value) return value end,
}
package.loaded["ffi/util"] = {
    template = function(value, ...)
        local values = { ... }
        return (tostring(value):gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}
package.loaded["gettext"] = function(text) return text end
package.loaded["bookorbit_state_manager"] = {}
package.loaded["bookorbit_download_transfer"] = {}
package.loaded["bookorbit_bulk_checkpoint"] = { MAX_FAILURES = 8 }
package.loaded["bookorbit_capabilities"] = { has = function() return false end }

-- The chooser is KOReader's own directory browser; the test drives its confirm
-- callback directly rather than rendering it.
local chooser = { opened = 0, start_dir = nil, confirm = nil }
package.loaded["ui/downloadmgr"] = {
    new = function(_, opts)
        return {
            chooseDir = function(_, start_dir)
                chooser.opened = chooser.opened + 1
                chooser.start_dir = start_dir
                chooser.confirm = opts.onConfirm
            end,
        }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BulkDownload = require("bookorbit_catalog_bulk_download")
local CatalogDownload = require("bookorbit_catalog_download")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local stored = { download_dir = "/mnt/onboard/Books" }
local saved = {}
G_reader_settings = {
    readSetting = function(_, key) return stored[key] end,
    saveSetting = function(_, key, value)
        stored[key] = value
        table.insert(saved, { key = key, value = value })
    end,
    flush = function() end,
}

local Catalog = {}
BulkDownload.install(Catalog)
CatalogDownload.install(Catalog)
Catalog.settings = {}
Catalog:initBulkDownloadState()

local function findButton(dialog, prefix)
    for _, row in ipairs(dialog.buttons or {}) do
        for _, button in ipairs(row) do
            if button.text and button.text:sub(1, #prefix) == prefix then return button end
        end
    end
    return nil
end

-- The bulk settings popup offers the folder alongside the other two knobs.
Catalog:showBulkDownloadSettings()
local settings_dialog = shown[#shown]
assertEqual(settings_dialog.title, "Bulk download settings", "the settings popup opened")

local folder_button = findButton(settings_dialog, "Folder:")
assertEqual(folder_button ~= nil, true, "the folder is offered as a button")
assertEqual(folder_button.text, "Folder: /mnt/onboard/Books", "the button reports the current folder")
assertEqual(findButton(settings_dialog, "Format:") ~= nil, true, "the format knob is still offered")
assertEqual(findButton(settings_dialog, "Existing files:") ~= nil, true, "the existing-files knob is still offered")

-- Choosing a folder writes the one setting the download path is built from.
folder_button.callback()
assertEqual(chooser.opened, 1, "the chooser opened")
assertEqual(chooser.start_dir, "/mnt/onboard/Books", "the chooser starts at the current folder")

chooser.confirm("/mnt/onboard/Books/BookOrbit")
assertEqual(#saved, 1, "one setting was written")
assertEqual(saved[1].key, "download_dir", "the shared download_dir is what changed")
assertEqual(saved[1].value, "/mnt/onboard/Books/BookOrbit", "the chosen path was stored")

-- The popup reopens on the next tick so the new folder is visible without the
-- user having to find their way back into the menu.
assertEqual(#next_ticks, 1, "the caller was scheduled to reopen")
next_ticks[1]()
assertEqual(findButton(shown[#shown], "Folder:").text, "Folder: /mnt/onboard/Books/BookOrbit",
    "the reopened popup shows the new folder")

-- The same choice is what a bulk run then downloads into, and what its
-- confirmation reports.
assertEqual(Catalog:getCurrentDownloadDir(), "/mnt/onboard/Books/BookOrbit", "bulk downloads follow the choice")
local title = Catalog:bulkConfirmationTitle({ total = 3, label = "Current page" })
assertEqual(title:find("Folder: /mnt/onboard/Books/BookOrbit", 1, true) ~= nil, true,
    "the confirmation reports the chosen folder")

-- An over-long path keeps the end, which is the part that says where the files
-- actually land; truncating the other way would leave every folder looking the
-- same.
local CatalogUtil = require("bookorbit_catalog_util")
local deep = "/mnt/onboard/Books/Fiction/Science Fiction/Series/Long Name"
local short = CatalogUtil.shortPath(deep, 24)
assertEqual(#short, 24, "the label is bounded")
assertEqual(short:sub(1, 3), "...", "the truncation is marked")
assertEqual(deep:sub(-10), short:sub(-10), "the tail of the path survives")
assertEqual(CatalogUtil.shortPath("/short", 24), "/short", "a short path is left alone")

print("bookorbit_download_folder_test.lua: ok")
