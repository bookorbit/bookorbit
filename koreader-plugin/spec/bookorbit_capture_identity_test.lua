-- The close and suspend handlers are on a hard latency budget, so the snapshot
-- they capture must not open statistics.sqlite3. Identity is primed once the
-- reader is ready instead; a cold cache still resolves, and a cached miss falls
-- back at drain time.

package.path = "koreader-plugin/spec/?.lua;" .. package.path

local FakeSqlite = require("helpers/fake_sqlite")

package.loaded["datastorage"] = {
    getSettingsDir = function() return "/nonexistent" end,
}
local book_rows = { { "42", "Statistics Title", "Statistics Author", "1700000000" } }
local sqlite = FakeSqlite.install(function(sql)
    if sql:find("FROM book WHERE md5", 1, true) then
        return FakeSqlite.resultSet(book_rows)
    end
    return nil
end)
package.loaded["logger"] = {
    dbg = function() end,
    err = function(_, message) error(message) end,
    info = function() end,
    warn = function() end,
}
package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function() return nil end,
            saveSetting = function() end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/notification"] = { notify = function() end }
package.loaded["ui/trapper"] = { wrap = function(_, callback) callback() end }
package.loaded["ui/uimanager"] = {
    scheduleIn = function() end,
    getElapsedTimeSinceBoot = function() return 0 end,
    show = function() end,
}
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
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
    canSkipExchange = function() return false end,
    rememberExchanged = function() end,
}
package.loaded["bookorbit_api"] = { new = function() return {} end }
package.loaded["bookorbit_highlight_summary"] = {
    normalize = function(value) return value end,
    add = function(value) return value end,
    hasCounts = function() return false end,
}
package.loaded["bookorbit_state"] = {
    applyStatsAck = function() return false end,
    isMatchFresh = function() return false end,
    applyLibraryVersion = function() return false end,
}
package.loaded["bookorbit_state_manager"] = { session = function() return {} end }
package.loaded["bookorbit_sweep"] = { isRunning = function() return false end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitStatsReader = require("bookorbit_stats_reader")
local BookOrbitSidecar = require("bookorbit_sidecar")
local BookSync = require("bookorbit_book_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local flushes = 0
local plugin = {
    ui = {
        document = { file = "/books/a.epub" },
        annotation = {
            annotations = {
                {
                    drawer = "lighten",
                    datetime = "2026-07-08 09:00:00",
                    pos0 = "/body/p[1]",
                    pos1 = "/body/p[1].12",
                    text = "captured while open",
                },
            },
        },
        doc_settings = { readSetting = function() return {} end },
        statistics = {
            settings = { is_enabled = true },
            insertDB = function() flushes = flushes + 1 end,
        },
    },
    getDocumentDigest = function() return "abc123" end,
    getLastPercent = function() return 0.5 end,
    getLastProgress = function() return "/6/4" end,
}

-- Primed after reader ready: one lookup, then the handler pays nothing.
BookOrbitStatsReader.forgetIdentity()
sqlite.opens = 0
BookOrbitStatsReader.primeIdentity("abc123")
assertEqual(sqlite.opens, 1, "priming performs the single identity lookup")

local snap = BookSync.capture(plugin)
assertEqual(sqlite.opens, 1, "capture opens no database when identity is primed")
assertEqual(flushes, 1, "the pending page-stat flush still runs live at capture")
assertEqual(#snap.stats_ids, 1, "the snapshot carries the statistics row ids")
assertEqual(snap.stats_ids[1], 42, "the row id comes from the primed identity")
assertEqual(snap.title, "Statistics Title", "stable identity fields come from the cache")
assertEqual(snap.percentage, 0.5, "progress is read live, never cached")
assert(type(snap.ann_signature) == "string" and snap.ann_signature ~= "",
    "the snapshot carries the annotation change signal")

-- The snapshot must not alias the cached identity, or a later mutation of one
-- would silently rewrite the other.
snap.stats_ids[1] = 99
local cached = BookOrbitStatsReader.cachedIdentity("abc123")
assertEqual(cached.ids[1], 42, "the snapshot holds its own copy of the row ids")

-- A cold cache still resolves, so a plugin loaded mid-session captures fully.
BookOrbitStatsReader.forgetIdentity()
sqlite.opens = 0
local cold = BookSync.capture(plugin)
assertEqual(sqlite.opens, 1, "a cold capture falls back to a live lookup")
assertEqual(cold.stats_ids[1], 42, "the cold capture carries the same row ids")

local warm = BookSync.capture(plugin)
assertEqual(sqlite.opens, 1, "the fallback primes the cache for the next handler")
assertEqual(warm.stats_ids[1], 42, "the warmed capture carries the same row ids")

-- A book with no statistics row yet is a cached miss, not a cache bypass; the
-- drain resolves it through getBookIds() instead.
book_rows = {}
BookOrbitStatsReader.forgetIdentity()
sqlite.opens = 0
BookOrbitStatsReader.primeIdentity("abc123")
local missing = BookSync.capture(plugin)
assertEqual(sqlite.opens, 1, "a cached miss is not re-queried by the handler")
assertEqual(#missing.stats_ids, 0, "a missing statistics row captures no ids")
local entry, was_cached = BookOrbitStatsReader.cachedIdentity("abc123")
assertEqual(entry, nil, "the cached miss stores no row")
assertEqual(was_cached, true, "a miss is still cached, so the handler stops looking")
assertEqual(select(2, BookOrbitStatsReader.cachedIdentity("other")), false,
    "another book is not answered from this book's cache")

-- Bounded state pull.
local MAX_AGE = BookOrbitSidecar.STATE_PULL_MAX_AGE
assertEqual(BookOrbitSidecar.needsStatePull({}, 1000), true,
    "a book that never pulled server state pulls now")
local pulled = {}
BookOrbitSidecar.markStatePulled(pulled, 1000)
assertEqual(BookOrbitSidecar.needsStatePull(pulled, 1000 + MAX_AGE), false,
    "a recently pulled book makes no state request when nothing changed locally")
assertEqual(BookOrbitSidecar.needsStatePull(pulled, 1000 + MAX_AGE + 1), true,
    "the bounded refresh interval brings web-side ratings and reviews back")
assertEqual(BookOrbitSidecar.needsStatePull(pulled, 900), true,
    "a stamp in the device's future is treated as expired")

local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

local plugin_dir = "koreader-plugin/bookorbit.koplugin/"
local book_sync_source = read(plugin_dir .. "bookorbit_book_sync.lua")
local step_state = assert(book_sync_source:match("stepState = function%(ctx%)%s*(.-)%s*stepProgress = function"))
assert(step_state:find("BookOrbitSidecar.needsStatePull", 1, true),
    "the state step must bound its forced pull instead of forcing one every time")
assert(not step_state:find("}, true)", 1, true),
    "the state payload must no longer be built with an unconditional forced pull")

local main = read(plugin_dir .. "main.lua")
local reader_ready = assert(main:match(
    "function BookOrbit:onReaderReady%(%)%s*(.-)%s*local function titleFromFile"))
assert(reader_ready:find("BookOrbitStatsReader.primeIdentity", 1, true),
    "identity is primed after reader ready, not inside the lifecycle handlers")

for _, handler_pattern in ipairs({
    "function BookOrbit:_onCloseDocument%(%)%s*(.-)%s*function BookOrbit:_onPageUpdate",
    "function BookOrbit:_onSuspend%(%)%s*(.-)%s*function BookOrbit:_onNetworkConnected",
}) do
    local handler = assert(main:match(handler_pattern))
    assert(not handler:find("BookOrbitStatsReader", 1, true),
        "lifecycle handlers must not reach for the statistics database themselves")
end

print("bookorbit_capture_identity_test.lua: ok")
