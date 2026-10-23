-- Closes queued while offline wait in the lifecycle outbox. The reader's
-- instance drains it when Wi-Fi returns, but after closing a book KOReader shows
-- the file browser, whose instance never listened for the network, so the queue
-- waited for a book open or a manual sync (S-45).

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

for _, name in ipairs({ "device", "dispatcher", "ui/widget/infomessage", "ui/network/manager",
    "pluginshare", "ui/trapper", "ui/uimanager", "logger", "libs/libkoreader-lfs", "ffi/sha2",
    "bookorbit_api", "bookorbit_catalog", "bookorbit_lifecycle_outbox", "bookorbit_open_annotation_scheduler",
    "bookorbit_state", "bookorbit_stats_reader", "bookorbit_sync_coordinator", "bookorbit_sync_job_runner",
    "bookorbit_menu_pin" }) do
    package.loaded[name] = {}
end
package.loaded["logger"] = { dbg = function() end, err = function() end }
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["gettext"] = function(text) return text end
package.loaded["ui/widget/container/widgetcontainer"] = { extend = function(_, value) return value end }
for _, name in ipairs({ "bookorbit_main_menu", "bookorbit_progress_sync", "bookorbit_updater", "bookorbit_activity" }) do
    package.loaded[name] = { install = function() end }
end
package.loaded["bookorbit_book_sync"] = { isRunning = function() return false end }
package.loaded["bookorbit_sweep"] = { isRunning = function() return false end }
package.loaded["bookorbit_state_manager"] = {
    session = function()
        return { getBook = function() return {} end, flush = function() end }
    end,
}
package.loaded["bookorbit_highlight_summary"] = {
    add = function(summary) return summary end,
    addBookmarks = function(summary) return summary end,
    hasRemoteChanges = function() return false end,
    hasRemoteBookmarkChanges = function() return false end,
}
package.loaded["bookorbit_sidecar"] = {}

package.loaded["bookorbit_annotations"] = {}
package.loaded["bookorbit_bookmarks"] = {}
G_reader_settings = { flush = function() end }

local Plugin = dofile("koreader-plugin/bookorbit.koplugin/main.lua")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function instance(in_reader, auto_sync)
    return setmetatable({ in_reader = in_reader, settings = { auto_sync = auto_sync } }, { __index = Plugin })
end

local browser = instance(false, true)
browser:registerEvents()
assertEqual(browser.onNetworkConnected, Plugin._onNetworkConnected, "the file browser drains the outbox when Wi-Fi returns")
assertEqual(rawget(browser, "onCloseDocument"), nil, "the file browser takes no reader events")
assertEqual(rawget(browser, "onSuspend"), nil, "nor suspend")

local quiet = instance(false, false)
quiet:registerEvents()
assertEqual(rawget(quiet, "onNetworkConnected"), nil, "auto sync off leaves the network alone")

local reader = instance(true, true)
reader:registerEvents()
assertEqual(reader.onNetworkConnected, Plugin._onNetworkConnected, "the reader still drains on reconnect")
assertEqual(reader.onCloseDocument, Plugin._onCloseDocument, "and keeps its reader events")

print("bookorbit_browser_network_drain_test: ok")
