package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local FakeScheduler = require("helpers/fake_scheduler")
local scheduler = FakeScheduler.new()
local calls = {}
local progress_request
local acknowledged = {}
local remote_pending
local finished
local annotation_result = {
    uploaded = 1,
    applied = 0,
    deleted = 0,
    failed = 0,
    had_errors = false,
}
local last_annotation_opts

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
    exchangeBook = function(opts)
        last_annotation_opts = opts
        table.insert(calls, "annotations")
        assert(opts.annotations[1].text == "captured while open")
        return annotation_result
    end,
    canSkipExchange = function() return false end,
    rememberExchanged = function() end,
}
package.loaded["bookorbit_api"] = {
    new = function()
        return {
            isConfigured = function() return true end,
            matchCheck = function()
                table.insert(calls, "match")
                return {
                    matches = {
                        { hash = "abcdef", bookFileId = "file-1", bookId = "book-1" },
                    },
                }
            end,
            updateProgress = function(_, digest, percentage, progress, timestamp)
                progress_request = { digest = digest, percentage = percentage, progress = progress, timestamp = timestamp }
                table.insert(calls, "progress")
                return {}
            end,
        }
    end,
}
package.loaded["bookorbit_highlight_summary"] = {
    normalize = function(value) return value end,
    add = function(value) return value end,
    hasCounts = function() return false end,
}
package.loaded["bookorbit_sidecar"] = {
    normalizeAnnotations = function(raw) return raw end,
    buildStatePayload = function()
        table.insert(calls, "state")
        return nil
    end,
    sidecarMtime = function() return nil end,
    needsStatePull = function() return true end,
    markStatePulled = function() end,
    isMarked = function() return nil end,
    readMarked = function() return false end,
    sidecarState = function() return nil end,
    markLive = function() return false end,
    markFile = function() return false end,
}

local book
local flushes = 0
local state = {
    global = {},
    getBook = function() return book end,
    setMatched = function(_, _, file_id, book_id, file)
        book = {
            fileId = file_id,
            bookId = book_id,
            file = file,
            statsWatermark = 0,
            annWatermark = "",
        }
    end,
    setUnmatched = function() book = nil end,
    rememberFile = function() end,
    flush = function() flushes = flushes + 1 end,
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
    getBookIds = function()
        error("captured stable statistics ids must be reused")
    end,
    getEventsAfter = function(ids, watermark)
        table.insert(calls, "stats")
        assert(ids[1] == 42)
        assert(watermark == 0, "replay reads the live watermark, not a stale snapshot copy")
        return {}
    end,
}
package.loaded["bookorbit_sweep"] = {
    isRunning = function() return false end,
}

local BookSync = require("bookorbit_book_sync")

local snapshot = {
    digest = "abcdef",
    file = "/books/deleted.epub",
    stats_ids = { 42 },
    annotations = { { text = "captured while open" } },
    ann_count = 1,
    percentage = 0.75,
    progress = "/6/4",
    ts = 1000,
}

local started = BookSync.run{
    api = {},
    snap = snapshot,
    reason = "recovery",
    plugin = {},
    acknowledged = {
        match = false,
        stats = false,
        annotations = false,
        state = false,
        progress = false,
    },
    on_phase_ack = function(phase)
        table.insert(acknowledged, phase)
        return true
    end,
    on_remote_pending = function(kind, payload)
        remote_pending = { kind = kind, payload = payload }
        return true
    end,
    on_finish = function(err)
        finished = err or true
    end,
}

assert(started == true)
assert(#calls == 0, "run must return before starting request work")
scheduler:drain()
assert(table.concat(calls, ",") == "match,stats,annotations,state,progress")
assert(table.concat(acknowledged, ",") == "match,stats,annotations,state,progress")
-- match, annotations and progress mutate local state and flush before their
-- acknowledgement; the stats and state phases short-circuit and must not.
assert(flushes == 4, "only mutating phases flush, got " .. tostring(flushes))
assert(finished == true)
assert(last_annotation_opts.keys_complete == false, "an unavailable document cannot authorize deletions from a queued snapshot")

scheduler = FakeScheduler.new()
calls = {}
acknowledged = {}
snapshot.ts = 1001
local replay_ack = { match = true, stats = true, annotations = true, state = true, progress = false }
assert(BookSync.run{
    api = {}, snap = snapshot, reason = "recovery", plugin = {}, acknowledged = replay_ack,
    on_phase_ack = function(phase) replay_ack[phase] = true; return true end,
})
scheduler:drain()
assert(table.concat(calls, ",") == "progress",
    "a fresh snapshot must push even when this device last uploaded the same percentage")
assert(progress_request.timestamp == 1001 and progress_request.progress == snapshot.progress)
calls = {}
assert(BookSync.run{
    api = {}, snap = snapshot, reason = "recovery", plugin = {}, acknowledged = replay_ack,
})
scheduler:drain()
assert(#calls == 0, "acknowledged snapshot replay must not upload progress again")
snapshot.ts = 1000

scheduler = FakeScheduler.new()
calls = {}
acknowledged = {}
remote_pending = nil
finished = nil
book = nil
annotation_result = {
    uploaded = 1,
    applied = 0,
    deleted = 0,
    failed = 0,
    had_errors = false,
    remote_pending = {
        to_apply = { add = { { serverId = "remote-1" } } },
    },
}

assert(BookSync.run{
    api = {},
    snap = snapshot,
    reason = "recovery",
    plugin = {},
    acknowledged = {
        match = false,
        stats = true,
        annotations = false,
        state = false,
        progress = false,
    },
    on_phase_ack = function(phase)
        table.insert(acknowledged, phase)
        return true
    end,
    on_remote_pending = function(kind, payload)
        remote_pending = { kind = kind, payload = payload }
        return true
    end,
    on_finish = function(err)
        finished = err or true
    end,
})
scheduler:drain()
assert(remote_pending and remote_pending.kind == "annotations",
    "remote changes are retained when the original file is missing")
assert(table.concat(acknowledged, ",") == "match,state,progress",
    "unapplied remote annotation phase remains unacknowledged")
assert(finished == true)

local current = { { text = "delivered after the queued snapshot" } }
assert(BookSync.run{
    api = {}, snap = snapshot, reason = "recovery",
    plugin = { ui = { document = { file = snapshot.file }, annotation = { annotations = current } } },
    acknowledged = { match = true, stats = true, annotations = false, state = true, progress = true },
})
scheduler:drain()
assert(last_annotation_opts.annotations == snapshot.annotations, "queued edits remain available for upload")
assert(last_annotation_opts.key_annotations == current, "deletion checks use current live keys rather than the old snapshot")
assert(last_annotation_opts.keys_complete == true, "a current live key set remains authoritative")
assert(last_annotation_opts.apply_mode == "live", "recovery applies to the current reader rather than acknowledging disk-only changes")

print("bookorbit_book_sync_outbox_test.lua: ok")
