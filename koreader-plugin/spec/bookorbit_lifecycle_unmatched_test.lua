package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local removed = 0
local finished = 0
local recorded_errors = 0
local flushes = 0
local entry = {
    id = "entry_f57f1d89ea1f37a9c43b68371cb7899d_1000_1",
    generation = 33,
    attempts = 32,
    acknowledged = {
        match = false,
        stats = false,
        annotations = false,
        state = false,
        progress = false,
    },
    snapshot = {
        digest = "f57f1d89ea1f37a9c43b68371cb7899d",
        file = "./help/quickstart-C-v2026.07.2.html",
        title = "KOReader Quickstart Guide",
        stats_ids = {},
        annotations = {},
    },
}

for _, name in ipairs({ "device", "dispatcher", "ui/widget/infomessage", "pluginshare",
    "ui/trapper", "logger", "ffi/sha2", "bookorbit_api", "bookorbit_catalog",
    "bookorbit_lifecycle_outbox", "bookorbit_open_annotation_scheduler", "bookorbit_state", "bookorbit_stats_reader",
    "bookorbit_sync_coordinator", "bookorbit_sync_job_runner", "bookorbit_menu_pin" }) do
    package.loaded[name] = {}
end
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}
package.loaded["ui/widget/container/widgetcontainer"] = {
    extend = function(_, value) return value end,
}
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["ui/network/manager"] = {
    isConnected = function() return true end,
}
package.loaded["ui/uimanager"] = {
    nextTick = function(_, callback) callback() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
}
for _, name in ipairs({ "bookorbit_main_menu", "bookorbit_progress_sync", "bookorbit_updater" }) do
    package.loaded[name] = { install = function() end }
end
package.loaded["bookorbit_annotations"] = {}
package.loaded["bookorbit_bookmarks"] = {}
package.loaded["bookorbit_highlight_summary"] = {
    add = function(summary) return summary end,
    addBookmarks = function(summary) return summary end,
    hasRemoteChanges = function() return false end,
    hasRemoteBookmarkChanges = function() return false end,
}
package.loaded["bookorbit_sidecar"] = {}
package.loaded["bookorbit_sweep"] = { isRunning = function() return false end }
package.loaded["bookorbit_sync_coordinator"] = { PRIORITY = { lifecycle = 300 } }
package.loaded["bookorbit_state_manager"] = {
    setAccount = function() end,
    getBook = function() return nil end,
}
package.loaded["bookorbit_book_sync"] = {
    isRunning = function() return false end,
    run = function(opts)
        opts.on_finish("unmatched")
        return true
    end,
}

local outbox = {
    nextEntry = function()
        if removed > 0 then return nil end
        return entry
    end,
    readLatest = function()
        if removed > 0 then return nil end
        return entry
    end,
    markStarted = function() return entry end,
    isComplete = function() return false end,
    isBlocked = function() return true end,
    removeEntry = function()
        removed = removed + 1
        return true
    end,
    markFinished = function() finished = finished + 1 end,
}

G_reader_settings = { flush = function() flushes = flushes + 1 end }
package.loaded["device"].model = "Kindle"

local Plugin = dofile("koreader-plugin/bookorbit.koplugin/main.lua")
local plugin = setmetatable({
    settings = {
        server_url = "https://example.invalid",
        username = "reader",
        userkey = "secret",
        last_error = {
            event = "lifecycle_outbox",
            code = "outbox_blocked",
            message = "A pending lifecycle sync keeps failing and was parked.",
        },
    },
}, { __index = Plugin })

plugin.getLifecycleOutbox = function() return outbox end
plugin.submitSyncJob = function(_, job) job.run(function() end) end
plugin.scheduleLifecycleOutboxRetry = function() end
plugin.recordSyncError = function()
    recorded_errors = recorded_errors + 1
end

plugin:requestLifecycleOutboxDrain("manual", true)

assert(removed == 1, "an unmatched lifecycle entry is removed")
assert(finished == 0, "an unmatched lifecycle entry is not parked again")
assert(recorded_errors == 0, "an unmatched document does not produce a lifecycle error")
assert(plugin.settings.last_error == nil, "the stale parked warning is cleared")
assert(plugin.settings.activity_log[1].kind == "lifecycle_unmatched", "the skip is visible in Sync status")
assert(plugin.settings.activity_log[1].sub == "KOReader Quickstart Guide", "Sync status identifies the document")
assert(flushes == 1, "the resolved lifecycle state is persisted")

print("bookorbit_lifecycle_unmatched_test.lua: ok")
