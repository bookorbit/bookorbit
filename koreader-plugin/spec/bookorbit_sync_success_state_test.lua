package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
for _, name in ipairs({ "device", "dispatcher", "ui/widget/infomessage", "ui/network/manager",
    "ui/widget/notification", "pluginshare", "ui/trapper", "ui/uimanager", "logger",
    "libs/libkoreader-lfs", "ffi/sha2", "ffi/util", "bookorbit_annotations",
    "bookorbit_bookmarks", "bookorbit_api", "bookorbit_book_sync", "bookorbit_catalog",
    "bookorbit_highlight_summary", "bookorbit_lifecycle_outbox", "bookorbit_open_annotation_scheduler",
    "bookorbit_state", "bookorbit_state_manager", "bookorbit_stats_reader",
    "bookorbit_sync_coordinator", "bookorbit_sync_job_runner", "bookorbit_menu_pin", "bookorbit_sweep",
    "bookorbit_sidecar" }) do
    package.loaded[name] = {}
end
package.loaded["gettext"] = function(text) return text end
package.loaded["ui/widget/container/widgetcontainer"] = { extend = function(_, value) return value end }
for _, name in ipairs({ "bookorbit_main_menu", "bookorbit_progress_sync", "bookorbit_updater" }) do
    package.loaded[name] = { install = function() end }
end
local recorded = {}
package.loaded["bookorbit_activity"] = { recordSuccess = function(_, event) table.insert(recorded, event) end,
    recordError = function(_, event) table.insert(recorded, event) end }
local flushes = 0
G_reader_settings = { flush = function() flushes = flushes + 1 end }
local Plugin = dofile("koreader-plugin/bookorbit.koplugin/main.lua")
local previous_sync = { event = "progress_push", at = 1 }
local previous_error = { event = "annotation_sync", at = 2 }
local plugin = setmetatable({ settings = { last_sync = previous_sync, last_error = previous_error } }, { __index = Plugin })
plugin:recordSyncSuccess("connection_test", "Connected")
assert(plugin.settings.last_sync == previous_sync, "connection check preserves actual sync timestamp")
assert(plugin.settings.last_error == previous_error, "connection check preserves unrelated sync failure")
plugin.settings.last_error = { event = "connection_test" }
plugin:recordSyncSuccess("connection_test", "Connected")
assert(plugin.settings.last_error == nil, "successful connection clears previous connection failure")
plugin.settings.last_sync = nil
plugin:recordSyncSuccess("connection_test", "Connected")
assert(plugin.settings.last_sync == nil, "connection check cannot imply first sync")
plugin.settings.last_error = previous_error
plugin:recordSyncSuccess("progress_push", "Synced")
assert(plugin.settings.last_sync.event == "progress_push", "actual sync records event")
assert(plugin.settings.last_error == nil, "actual sync clears failure")
plugin.settings.last_error = previous_error
plugin:recordSyncError("connection_test", "network", "Connection refused")
assert(plugin.settings.last_error == previous_error, "connection failure cannot overwrite a sync failure")
plugin.settings.last_error = nil
plugin:recordSyncError("connection_test", "auth", "Login failed")
assert(plugin.settings.last_error.event == "connection_test", "connection failure remains available for diagnosis")
assert(#recorded == 6 and flushes == 6, "all actions persist activity")
print("bookorbit_sync_success_state_test.lua: ok")
