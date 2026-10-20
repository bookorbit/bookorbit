-- Single and bulk downloads write to one destination, KOReader's own
-- download_dir, so both sheets have to offer the same chooser and see each
-- other's choice.

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
package.loaded["gettext"] = setmetatable({
    ngettext = function(one, many, count) return count == 1 and one or many end,
}, { __call = function(_, text) return text end })
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

-- The bulk sheet is drawn elsewhere; here it records what it was opened with
-- and offers its Folder row the way the sheet does.
local plans = {}
package.loaded["bookorbit_bulk_sheet"] = {
    openPlan = function(catalog, plan)
        table.insert(plans, plan)
        return { catalog = catalog, plan = plan }
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
local persisted_dir
G_reader_settings = {
    readSetting = function(_, key) return stored[key] end,
    saveSetting = function(_, key, value)
        stored[key] = value
        table.insert(saved, { key = key, value = value })
    end,
    flush = function() persisted_dir = stored.download_dir end,
}

local Catalog = {}
BulkDownload.install(Catalog)
CatalogDownload.install(Catalog)
Catalog.settings = {}
Catalog.client = { server_url = "http://localhost", username = "test" }
Catalog:initBulkDownloadState()

-- The bulk settings sheet offers the folder alongside the other knobs.
Catalog:showBulkDownloadSettings()
assertEqual(#plans, 1, "the settings sheet opened")
assertEqual(plans[1].settings_only, true, "it opens as settings, with nothing to download")
assertEqual(Catalog:getCurrentDownloadDir(), "/mnt/onboard/Books", "the sheet's Folder row reports the current folder")

-- Its Folder row runs the shared chooser and redraws the sheet once the
-- choice is saved.
local redrawn = 0
Catalog:chooseDownloadDir(function() redrawn = redrawn + 1 end)
assertEqual(chooser.opened, 1, "the chooser opened")
assertEqual(chooser.start_dir, "/mnt/onboard/Books", "the chooser starts at the current folder")

chooser.confirm("/mnt/onboard/Books/BookOrbit")
assertEqual(#saved, 1, "one setting was written")
assertEqual(saved[1].key, "download_dir", "the shared download_dir is what changed")
assertEqual(saved[1].value, "/mnt/onboard/Books/BookOrbit", "the chosen path was stored")
assertEqual(persisted_dir, stored.download_dir, "the chosen folder is durable before the sheet redraws")

assertEqual(#next_ticks, 1, "the sheet was scheduled to redraw")
next_ticks[1]()
assertEqual(redrawn, 1, "the sheet redraws with the new folder")

-- The same choice is what a bulk run then downloads into.
assertEqual(Catalog:getCurrentDownloadDir(), "/mnt/onboard/Books/BookOrbit", "bulk downloads follow the choice")

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

local file = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_main_menu.lua"))
local source = file:read("*a")
file:close()
local block = assert(source:match("(function MainMenu:chooseDownloadFolder.-)\n%-%- %-%-+ shortcut"))
local MainMenu = {}
local chunk = assert(loadstring(block))
setfenv(chunk, setmetatable({ MainMenu = MainMenu, UIManager = package.loaded["ui/uimanager"] }, { __index = _G }))
chunk()
local returned = false
MainMenu:chooseDownloadFolder(nil, function()
    assertEqual(persisted_dir, "/path/to/library/downloads", "direct Settings chooser persists before returning")
    returned = true
end)
chooser.confirm("/path/to/library/downloads")
assertEqual(persisted_dir, stored.download_dir, "the fallback chooser also persists immediately")
assertEqual(returned, false, "the fallback waits until the chooser closes before returning")
next_ticks[#next_ticks]()
assertEqual(returned, true, "direct Settings receives the saved folder")

print("bookorbit_download_folder_test.lua: ok")
