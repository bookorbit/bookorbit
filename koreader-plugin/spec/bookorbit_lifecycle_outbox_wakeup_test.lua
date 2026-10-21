-- A sync cut off by a quit counts as an attempt, so a relaunch inside the
-- backoff found nothing to drain and nothing woke the entry again until the next
-- book open, close, suspend or network event. The plugin now schedules a drain
-- for when the earliest backoff runs out.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local scheduled = {}
local unscheduled = {}
for _, name in ipairs({ "device", "dispatcher", "ui/widget/infomessage", "ui/network/manager",
    "ui/widget/notification", "pluginshare", "ui/trapper", "logger",
    "libs/libkoreader-lfs", "ffi/sha2", "ffi/util", "bookorbit_annotations",
    "bookorbit_bookmarks", "bookorbit_api", "bookorbit_book_sync", "bookorbit_catalog",
    "bookorbit_highlight_summary", "bookorbit_lifecycle_outbox", "bookorbit_open_annotation_scheduler",
    "bookorbit_state", "bookorbit_state_manager", "bookorbit_stats_reader",
    "bookorbit_sync_coordinator", "bookorbit_sync_job_runner", "bookorbit_menu_pin", "bookorbit_sweep",
    "bookorbit_sidecar" }) do
    package.loaded[name] = {}
end
package.loaded["ui/uimanager"] = {
    scheduleIn = function(_, delay, callback) table.insert(scheduled, { delay = delay, callback = callback }) end,
    unschedule = function(_, callback) table.insert(unscheduled, callback) end,
}
package.loaded["gettext"] = function(text) return text end
package.loaded["ui/widget/container/widgetcontainer"] = { extend = function(_, value) return value end }
for _, name in ipairs({ "bookorbit_main_menu", "bookorbit_progress_sync", "bookorbit_updater", "bookorbit_activity" }) do
    package.loaded[name] = { install = function() end }
end
G_reader_settings = { flush = function() end }

local Plugin = dofile("koreader-plugin/bookorbit.koplugin/main.lua")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local retry_at
local drains = {}
local outbox = {
    nextRetryAt = function() return retry_at end,
    now = function() return 1000 end,
}
local plugin = setmetatable({ settings = {} }, { __index = Plugin })
plugin.getLifecycleOutbox = function() return outbox end
plugin.requestLifecycleOutboxDrain = function(_, source) table.insert(drains, source) end

retry_at = nil
plugin:scheduleLifecycleOutboxRetry()
assertEqual(#scheduled, 0, "nothing is scheduled when no entry is backing off")

retry_at = 1060
plugin:scheduleLifecycleOutboxRetry()
assertEqual(#scheduled, 1, "a backing-off entry schedules a wake-up")
assertEqual(scheduled[1].delay, 60, "the wake-up waits exactly for the backoff")

scheduled[1].callback()
assertEqual(drains[1], "retry", "the wake-up asks for a drain")
assertEqual(plugin.lifecycle_retry_task, nil, "a fired wake-up clears itself")

retry_at = 1000
plugin:scheduleLifecycleOutboxRetry()
assertEqual(scheduled[2].delay, 1, "a backoff ending now waits at least a second")
local pending_task = plugin.lifecycle_retry_task
retry_at = 1030
plugin:scheduleLifecycleOutboxRetry()
assertEqual(unscheduled[#unscheduled], pending_task, "a newer wake-up replaces the pending one")

plugin:onCloseWidget()
assertEqual(unscheduled[#unscheduled], scheduled[3].callback, "teardown cancels the pending wake-up")
assertEqual(plugin.lifecycle_retry_task, nil, "teardown leaves no wake-up behind")

print("bookorbit_lifecycle_outbox_wakeup_test: ok")
