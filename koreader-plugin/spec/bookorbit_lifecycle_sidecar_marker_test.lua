-- Lifecycle syncs drain as "recovery", so the origin captured on the outbox
-- entry is what decides whether the book's sidecar may be marked clean. Without
-- it every lifecycle-synced book looks changed to the next sweep forever.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local FakeScheduler = require("helpers/fake_scheduler")
local scheduler

local sidecar_mtime

package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["ui/trapper"] = {
    wrap = function(_, callback) callback() end,
}
package.loaded["ui/uimanager"] = {
    scheduleIn = function(_, delay, callback) scheduler:scheduleIn(delay, callback) end,
    getElapsedTimeSinceBoot = function() return 0 end,
    show = function() end,
}
package.loaded["logger"] = {
    dbg = function() end,
    err = function(_, message) error(message) end,
    info = function() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
}
package.loaded["ffi/util"] = {
    template = function(value) return value end,
}
package.loaded["gettext"] = function(value) return value end

package.loaded["bookorbit_bookmarks"] = {
    enabled = function() return false end,
    markUnsupported = function() end,
    canSkipExchange = function() return false end,
    rememberExchanged = function() end,
    exchangeBook = function() error("bookmark sync is off in this fixture") end,
}
package.loaded["bookorbit_annotations"] = {
    exchangeBook = function() error("every phase is already acknowledged") end,
    canSkipExchange = function() return false end,
    rememberExchanged = function() end,
}
package.loaded["bookorbit_api"] = {
    new = function()
        return {
            isConfigured = function() return true end,
            matchCheck = function() error("every phase is already acknowledged") end,
        }
    end,
}
package.loaded["bookorbit_highlight_summary"] = {
    normalize = function(value) return value end,
    add = function(value) return value end,
    hasCounts = function() return false end,
}
package.loaded["bookorbit_sidecar"] = {
    buildStatePayload = function() return nil end,
    sidecarMtime = function() return sidecar_mtime end,
    needsStatePull = function() return false end,
    markStatePulled = function() end,
}

local book
local state = {
    global = {},
    getBook = function() return book end,
    setMatched = function() end,
    setUnmatched = function() book = nil end,
    rememberFile = function() end,
    flush = function() end,
}
package.loaded["bookorbit_state_manager"] = {
    session = function() return state end,
}
package.loaded["bookorbit_state"] = {
    open = function() return state end,
    applyStatsAck = function() return false end,
    isMatchFresh = function() return false end,
    applyLibraryVersion = function() return false end,
}
package.loaded["bookorbit_stats_reader"] = {
    getBookIds = function() return {} end,
    getEventsAfter = function() return {} end,
}
package.loaded["bookorbit_sweep"] = {
    isRunning = function() return false end,
}

local BookSync = require("bookorbit_book_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function drain(origin, mtime_on_disk)
    scheduler = FakeScheduler.new()
    sidecar_mtime = mtime_on_disk
    book = { bookId = 1, fileId = 2, file = "/books/a.epub" }
    local finished
    assert(BookSync.run{
        api = {},
        snap = {
            digest = "abcdef",
            file = "/books/a.epub",
            mtime_at_capture = 5000,
            stats_ids = {},
            annotations = {},
            ann_count = 0,
            ts = 1000,
        },
        reason = "recovery",
        origin = origin,
        plugin = {},
        acknowledged = {
            match = true,
            stats = true,
            annotations = true,
            state = true,
            progress = true,
        },
        on_finish = function(err) finished = err or true end,
    })
    scheduler:drain()
    assertEqual(finished, true, "the drained entry completes")
    return book
end

assertEqual(drain("close", 5000).sidecarMtime, 5000,
    "a drained close-origin entry marks the sidecar clean")
assertEqual(drain("suspend", 5000).sidecarMtime, nil,
    "a suspend-origin entry leaves the marker unset, because ReaderUI flushes before CloseDocument only")
assertEqual(drain("close", 5001).sidecarMtime, nil,
    "a sidecar modified during the drain leaves the marker unset")
assertEqual(drain(nil, 5000).sidecarMtime, nil,
    "an entry with no recorded origin does not mark the sidecar clean")

local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

local main = read("koreader-plugin/bookorbit.koplugin/main.lua")
local drain_handler = assert(main:match(
    "function BookOrbit:requestLifecycleOutboxDrain%(source, interactive%)%s*(.-)%s*function BookOrbit:getSyncCoordinatorStatus"))
assert(drain_handler:find("origin = started.reason", 1, true),
    "the drain must carry the entry's captured origin into the sync")

print("bookorbit_lifecycle_sidecar_marker_test.lua: ok")
