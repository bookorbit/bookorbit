-- Sweep run control, statistics session reuse and incremental recheck
-- semantics. "Sync all books" is no longer a full rematch just because it is
-- interactive, the whole run shares one read-only statistics connection, and a
-- cancelled run stops at its next yield without letting an already-scheduled
-- step write anything.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local SweepHarness = require("helpers/sweep_harness")

local DAY = 24 * 3600
local NOW = os.time()

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertSameSet(actual, expected, label)
    local actual_keys = table.concat(SweepHarness.sortedKeys(actual), ",")
    local expected_keys = table.concat(SweepHarness.sortedKeys(expected), ",")
    assertEqual(actual_keys, expected_keys, label)
end

local BASE = {
    books = {
        { md5 = "aaa", id = 1, title = "A", last_open = 100 },
        { md5 = "bbb", id = 2, title = "B", last_open = 200 },
        { md5 = "ccc", id = 3, title = "C", last_open = 300 },
    },
    events = {
        [1] = { { page = 1, start_time = 500 } },
        [2] = { { page = 1, start_time = 400 } },
    },
    library_version = "v1",
}

local function freshState()
    return {
        books = {
            aaa = {
                bookId = 1, fileId = 11, statsWatermark = 0, annWatermark = "", annCount = 0,
                matchVerifiedAt = NOW, matchVerifiedVersion = "v1",
            },
            -- Verified two days ago, so the bounded age has expired.
            bbb = {
                bookId = 2, fileId = 12, statsWatermark = 1000, annWatermark = "", annCount = 0,
                matchVerifiedAt = NOW - 2 * DAY, matchVerifiedVersion = "v1",
            },
        },
        unmatched = {},
        files = {},
        global = { libraryVersion = "v1" },
    }
end

local function startSweep(harness, Sweep, opts)
    opts = opts or {}
    local finished, finish_err = false, nil
    local started = Sweep.run{
        api = {},
        interactive = opts.interactive ~= false,
        full_recheck = opts.full_recheck == true,
        annotation_sync = false,
        on_finish = function(err)
            finished = true
            finish_err = err
        end,
    }
    return started, function() return finished, finish_err end
end

-- An incremental "Sync all books" checks only what local state cannot vouch
-- for: a never-seen hash and a matched book whose stamp expired. The book
-- verified inside the age bound issues no request at all.
do
    local harness = SweepHarness.install{
        books = BASE.books,
        events = BASE.events,
        library_version = BASE.library_version,
        state = freshState(),
    }
    local Sweep = require("bookorbit_sweep")

    local started, result = startSweep(harness, Sweep)
    assertEqual(started, true, "the sweep starts")
    harness.scheduler:drain()

    local finished, err = result()
    assertEqual(finished, true, "the sweep finishes")
    assertEqual(err, nil, "the incremental sweep completes without error")
    assertEqual(#harness.calls.match, 1, "one match batch goes out")
    assertSameSet(SweepHarness.hashSet(harness.calls.match[1]), { bbb = true, ccc = true },
        "only the expired stamp and the never-seen hash are checked")

    -- SQLite session: one connection for the whole run, and the grouped latest
    -- event query answers "anything new?" so unchanged books cost no per-book
    -- event query.
    assertEqual(harness.sqlite.opens, 1, "the sweep opens one statistics connection")
    assertEqual(harness.sqlite.closes, 1, "the statistics connection is closed on finish")
    assertEqual(harness.calls.latest_event_queries, 1, "latest event times are read in one query")
    assertEqual(harness.calls.event_queries, 1,
        "only the book with events after its watermark issues a per-book event query")
    assertEqual(#harness.calls.page_stats, 1, "only that book uploads reading data")
    assertEqual(harness.calls.sweep_complete, 1, "the sweep is recorded server-side")
end

-- The explicit maintenance action still rechecks every known hash.
do
    local harness = SweepHarness.install{
        books = BASE.books,
        events = BASE.events,
        library_version = BASE.library_version,
        state = freshState(),
    }
    local Sweep = require("bookorbit_sweep")

    startSweep(harness, Sweep, { full_recheck = true })
    harness.scheduler:drain()

    assertEqual(#harness.calls.match, 1, "one match batch goes out")
    assertSameSet(SweepHarness.hashSet(harness.calls.match[1]), { aaa = true, bbb = true, ccc = true },
        "an explicit recheck includes the book that was still fresh")
end

-- A stored recheck flag keeps forcing a complete recheck without the user
-- asking, which is what a changed library-version token sets.
do
    local state = freshState()
    state.global.needsFullRecheck = true
    local harness = SweepHarness.install{
        books = BASE.books,
        events = BASE.events,
        library_version = BASE.library_version,
        state = state,
    }
    local Sweep = require("bookorbit_sweep")

    startSweep(harness, Sweep)
    harness.scheduler:drain()

    assertSameSet(SweepHarness.hashSet(harness.calls.match[1]), { aaa = true, bbb = true, ccc = true },
        "a pending full recheck still rechecks every hash")
    assertEqual(harness.state.global.needsFullRecheck, false,
        "a completed full recheck clears the flag")
end

-- A matched book with no statistics row and no history entry still expires.
do
    local state = freshState()
    state.books.ddd = {
        bookId = 4, fileId = 14, statsWatermark = 0, annWatermark = "", annCount = 0,
    }
    local harness = SweepHarness.install{
        books = { { md5 = "aaa", id = 1, title = "A", last_open = 100 } },
        events = {},
        library_version = BASE.library_version,
        state = state,
    }
    local Sweep = require("bookorbit_sweep")

    startSweep(harness, Sweep)
    harness.scheduler:drain()

    assertSameSet(SweepHarness.hashSet(harness.calls.match[1]), { bbb = true, ddd = true },
        "a candidate-less matched book with no stamp is refreshed by the sweep")
end

-- Cancellation stops the run at its next yield: the step already scheduled
-- runs, sees it is no longer the current generation and writes nothing.
do
    local harness = SweepHarness.install{
        books = BASE.books,
        events = BASE.events,
        library_version = BASE.library_version,
        state = freshState(),
    }
    local Sweep = require("bookorbit_sweep")

    local _, result = startSweep(harness, Sweep)
    -- Enumeration, candidate conversion, history resolution and match-queue
    -- construction, stopping just before the first request.
    for _ = 1, 4 do
        harness.scheduler:runOne()
    end
    assertEqual(#harness.calls.match, 0, "no request has gone out yet")
    assert(harness.scheduler:pendingCount() > 0, "a step is already scheduled")

    assertEqual(Sweep.cancel("user"), true, "cancelling an active run reports success")
    assertEqual(Sweep.isRunning(), false, "a cancelled sweep stops running immediately")
    assertEqual(harness.sqlite.closes, 1, "cancellation closes the statistics session")

    local finished, err = result()
    assertEqual(finished, true, "the run reports completion to its caller")
    assertEqual(err, "cancelled", "it reports itself as cancelled rather than failed")

    harness.scheduler:drain()
    assertEqual(#harness.calls.match, 0, "the step scheduled by the cancelled run issues no request")
    assertEqual(harness.calls.sweep_complete, 0, "a cancelled run is not recorded as a completed sweep")
    assertEqual(harness.sqlite.opens, 1, "no further statistics connection is opened")

    assertEqual(Sweep.cancel("user"), false, "cancelling again is a no-op")

    -- A new run is accepted right away, and the superseded one cannot disturb it.
    local restarted, restart_result = startSweep(harness, Sweep)
    assertEqual(restarted, true, "a new sweep can start after a cancellation")
    harness.scheduler:drain()
    assertEqual(select(2, restart_result()), nil, "the restarted sweep completes normally")
    assertEqual(harness.calls.sweep_complete, 1, "the restarted run records exactly one sweep")
end

print("bookorbit_sweep_test.lua: ok")
