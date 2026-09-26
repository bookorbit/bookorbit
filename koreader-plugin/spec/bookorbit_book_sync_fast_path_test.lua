-- The drained lifecycle sync must actually stop issuing the match and
-- annotation requests when local state says nothing changed, while still
-- acknowledging every phase so the outbox entry can complete.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local FakeScheduler = require("helpers/fake_scheduler")
local scheduler

local calls
local last_match_candidates
local stats_watermarks
local page_stat_events
local last_stats_upload
local bound_stats_row
local stored_stats_row
local match_fresh = false
local exchange_skippable = false

package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["ui/trapper"] = { wrap = function(_, callback) callback() end }
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
    attributes = function() return "file" end,
}
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["gettext"] = function(value) return value end

package.loaded["bookorbit_bookmarks"] = {
    enabled = function() return false end,
    markUnsupported = function() end,
    canSkipExchange = function() return false end,
    rememberExchanged = function() end,
    exchangeBook = function() error("bookmark sync is off in this fixture") end,
}
package.loaded["bookorbit_annotations"] = {
    exchangeBook = function()
        table.insert(calls, "annotations")
        return { uploaded = 0, applied = 0, deleted = 0, failed = 0, had_errors = false }
    end,
    canSkipExchange = function() return exchange_skippable end,
    rememberExchanged = function() end,
}
package.loaded["bookorbit_api"] = {
    new = function()
        return {
            isConfigured = function() return true end,
            matchCheck = function(_, _, candidates)
                table.insert(calls, "match")
                last_match_candidates = candidates
                local target = candidates.abcdef.book_file_id or 2
                return {
                    libraryVersion = "lib-v1",
                    matches = { { hash = "abcdef", bookFileId = target, bookId = target + 10 } },
                }
            end,
            uploadBookStates = function()
                table.insert(calls, "state")
                return { results = {} }
            end,
            uploadPageStats = function(_, books)
                table.insert(calls, "stats")
                last_stats_upload = books[1]
                return {
                    results = { { hash = books[1].hash, watermark = books[1].events[#books[1].events].startTime } },
                    unmatched = {},
                }
            end,
            updateProgress = function()
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

local state_payload
package.loaded["bookorbit_sidecar"] = {
    -- Mirrors the real contract: a bare hash payload is the pull request, and
    -- nothing at all goes out when neither side changed and no pull is forced.
    buildStatePayload = function(hash, _, _, force_pull)
        if state_payload or force_pull then return { hash = hash } end
        return nil
    end,
    sidecarMtime = function() return nil end,
    needsStatePull = function() return false end,
    markStatePulled = function() end,
    stateFromServerResult = function() return nil end,
    rememberUploadedState = function() end,
}

local book
local state = {
    global = { libraryVersion = "lib-v1" },
    getBook = function() return book end,
    setMatched = function(_, _, book_file_id, book_id, file)
        book.fileId = book_file_id
        book.bookId = book_id
        book.file = file or book.file
    end,
    setUnmatched = function() book = nil end,
    rememberFile = function() end,
    getStatsRow = function(_, id, md5, title, authors)
        if not stored_stats_row then
            stored_stats_row = {
                id = id, md5 = md5, title = title, authors = authors, statsWatermark = 0,
            }
        end
        return stored_stats_row
    end,
    bindStatsRow = function(_, id, md5, title, authors, book_file_id, book_id)
        bound_stats_row = {
            id = id, md5 = md5, title = title, authors = authors,
            bookFileId = book_file_id, bookId = book_id, statsWatermark = 0,
        }
        stored_stats_row = bound_stats_row
        return bound_stats_row
    end,
    flush = function() end,
}
package.loaded["bookorbit_state_manager"] = { session = function() return state end }
package.loaded["bookorbit_state"] = {
    open = function() return state end,
    applyStatsAck = function() return false end,
    isMatchFresh = function() return match_fresh end,
    applyLibraryVersion = function() return false end,
}
package.loaded["bookorbit_stats_reader"] = {
    getBookIds = function() return {} end,
    getEventsAfter = function(_, watermark)
        table.insert(stats_watermarks, watermark)
        return page_stat_events
    end,
}
package.loaded["bookorbit_sweep"] = { isRunning = function() return false end }

local BookSync = require("bookorbit_book_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function run(opts)
    scheduler = FakeScheduler.new()
    calls = {}
    stats_watermarks = {}
    page_stat_events = opts.page_stat_events or {}
    last_stats_upload = nil
    bound_stats_row = nil
    stored_stats_row = opts.stored_stats_row
    book = {
        bookId = 1,
        fileId = 2,
        file = "/books/a.epub",
        statsWatermark = opts.stats_watermark or 0,
        annWatermark = "",
    }
    local acknowledged = {}
    local finished
    assert(BookSync.run{
        api = {},
        snap = {
            digest = "abcdef",
            file = "/books/a.epub",
            stats_ids = { 42 },
            stats_identity_repaired = opts.stats_identity_repaired == true,
            stats_row_ambiguous = opts.stats_row_ambiguous == true,
            stats_row = opts.stats_row,
            annotations = {},
            ann_count = 0,
            ann_signature = "0::0:0",
            percentage = 0.5,
            progress = "/6/4",
            ts = 1000,
        },
        reason = opts.reason or "recovery",
        origin = opts.origin,
        interactive = opts.interactive == true,
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
        on_finish = function(err) finished = err or true end,
    })
    scheduler:drain()
    assertEqual(finished, true, "the sync completes")
    return table.concat(calls, ","), table.concat(acknowledged, ",")
end

match_fresh = false
exchange_skippable = false
local requests, acks = run{}
assertEqual(requests, "match,annotations,progress",
    "a book with no usable local freshness still performs the full request chain")
assertEqual(last_match_candidates.abcdef.book_file_id, 2,
    "current-book recovery carries the previously verified server file id")
assertEqual(acks, "match,stats,annotations,state,progress", "every phase is acknowledged")

match_fresh = true
exchange_skippable = true
requests, acks = run{}
assertEqual(requests, "progress",
    "a known unchanged book only pushes what actually changed")
assertEqual(acks, "match,stats,annotations,state,progress",
    "skipped phases are still acknowledged, so the outbox entry can complete")

-- A sync the user asked for must not be answered from the skip stamps.
requests = run{ reason = "manual", interactive = true }
assertEqual(requests, "annotations,state,progress",
    "an interactive sync always exchanges annotations and pulls state")

-- Locally changed state still uploads even when the pull is not forced.
match_fresh = true
exchange_skippable = true
state_payload = true
requests = run{}
assertEqual(requests, "state,progress",
    "a locally changed state uploads without forcing a pull")
state_payload = nil

match_fresh = true
exchange_skippable = true
requests = run{
    stats_identity_repaired = true,
    stats_watermark = 900,
    page_stat_events = { { page = 1, startTime = 500, durationSeconds = 60, totalPages = 100 } },
}
assertEqual(stats_watermarks[1], 0, "identity repair replays exact-row history before the stored watermark")
assertEqual(requests, "stats,progress", "the stranded historical event is uploaded under the repaired digest")

match_fresh = true
requests = run{
    stats_row_ambiguous = true,
    stats_row = { id = 42, title = "Collision Two", authors = "Author B" },
    stats_watermark = 900,
    page_stat_events = { { page = 2, startTime = 600, durationSeconds = 60, totalPages = 100 } },
}
assertEqual(bound_stats_row.id, 42, "the exact live KOReader statistics row is bound")
assertEqual(bound_stats_row.bookFileId, 2, "the row is bound to the verified server file")
assertEqual(stats_watermarks[1], 0, "a newly bound collision row replays its own complete history")
assertEqual(last_stats_upload.bookFileId, 2, "collision events carry the explicit verified server target")
assertEqual(last_match_candidates.abcdef.book_file_id, nil,
    "a collision match never proposes the sibling hash-level file target")
assertEqual(requests, "match,stats,progress",
    "a collision row revalidates its target instead of trusting the shared hash cache")

requests = run{
    stats_row_ambiguous = true,
    stats_row = { id = 42, title = "Collision Two", authors = "Author B" },
    stored_stats_row = {
        id = 42,
        md5 = "abcdef",
        title = "Collision Two",
        authors = "Author B",
        bookFileId = 7,
        bookId = 17,
        statsWatermark = 500,
    },
}
assertEqual(last_match_candidates.abcdef.book_file_id, 7,
    "an established row-specific target is reused for collision revalidation")

print("bookorbit_book_sync_fast_path_test.lua: ok")
