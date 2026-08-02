-- The statistics reader now binds parameters into prepared statements instead
-- of formatting SQL, and one-shot helpers run on a short-lived session. These
-- assertions pin the binding order, the one-connection-per-call lifecycle and
-- the single reopen a busy database gets before the query is given up on.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local FakeSqlite = require("helpers/fake_sqlite")

package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end }
package.loaded["logger"] = { dbg = function() end, info = function() end, warn = function() end, err = function() end }

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function load(respond, opts)
    local stats = FakeSqlite.install(respond, opts)
    package.loaded["bookorbit_stats_reader"] = nil
    return require("bookorbit_stats_reader"), stats
end

-- Row ids and the digest guard.
do
    local seen
    local Reader, stats = load(function(sql, params)
        seen = { sql = sql, params = params }
        if sql:find("SELECT id FROM book", 1, true) then
            return FakeSqlite.resultSet{ { "7" }, { "9" } }
        end
        return nil
    end)

    local ids = Reader.getBookIds("abc123")
    assertEqual(#ids, 2, "both statistics rows of one digest come back")
    assertEqual(ids[1], 7, "row ids are numbers")
    assertEqual(seen.params[1], "abc123", "the digest is bound, not formatted into the SQL")
    assertEqual(stats.opens, 1, "a one-shot helper opens one connection")
    assertEqual(stats.closes, 1, "and closes it again")

    stats.queries = 0
    assertEqual(#Reader.getBookIds("not-hex"), 0, "a non-hex digest returns nothing")
    assertEqual(stats.queries, 0, "and never reaches the database")
end

-- Event batching binds the row ids, then the watermark, then the limit.
do
    local seen
    local Reader = load(function(sql, params)
        seen = { sql = sql, params = params }
        return FakeSqlite.resultSet{ { "12", "1700000000", "90000", "300" } }
    end)

    local events = Reader.getEventsAfter({ 3, 4 }, 1500, 500)
    assertEqual(#events, 1, "the batch comes back")
    assertEqual(events[1].page, 12, "page is numeric")
    assertEqual(events[1].durationSeconds, 86400, "an implausible duration is still clamped to a day")
    assertEqual(seen.params[1], 3, "the first row id is bound first")
    assertEqual(seen.params[2], 4, "then the second")
    assertEqual(seen.params[3], 1500, "then the watermark")
    assertEqual(seen.params[4], 500, "then the limit")
    assertEqual(select(2, seen.sql:gsub("%?", "")), 4, "the statement has one placeholder per bound value")
end

-- Dashboard reading summary.
do
    local today = os.date("%Y-%m-%d")
    local yesterday = os.date("%Y-%m-%d", os.time() - 86400)
    local Reader = load(function(sql)
        if sql:find("GROUP BY 1", 1, true) then
            return FakeSqlite.resultSet{ { yesterday, "600" }, { today, "1800" } }
        end
        if sql:find("COALESCE(SUM(", 1, true) then
            return FakeSqlite.resultSet{ { "1800" } }
        end
        if sql:find("SELECT DISTINCT date(", 1, true) then
            return FakeSqlite.resultSet{ { today }, { yesterday } }
        end
        return nil
    end)

    local summary = Reader.getReadingSummary()
    assertEqual(summary.today_seconds, 1800, "today's reading time is summed")
    assertEqual(summary.week_seconds, 1800, "the week window is summed too")
    assertEqual(summary.streak_days, 2, "consecutive reading days build the streak")
    assertEqual(summary.day_seconds[7], 1800, "today lands in the last per-day bucket")
    assertEqual(summary.day_seconds[6], 600, "yesterday lands in the bucket before it")
    assertEqual(summary.day_seconds[1], 0, "days without reading stay zero")
end

-- A busy database gets one reopen before the query is given up on.
do
    local Reader, stats = load(function(sql)
        if sql:find("SELECT id FROM book", 1, true) then
            return FakeSqlite.resultSet{ { "5" } }
        end
        return nil
    end, { fail_queries = 1 })

    local ids = Reader.getBookIds("abc123")
    assertEqual(#ids, 1, "the retry after a reopen succeeds")
    assertEqual(stats.opens, 2, "exactly one reopen is attempted")
end

-- A statistics session reuses one connection and one statement per shape.
do
    local Reader, stats = load(function(sql, params)
        if sql:find("FROM book WHERE md5 IS NOT NULL", 1, true) then
            local after_id = params[1] or 0
            if after_id >= 2 then return nil end
            return FakeSqlite.resultSet{
                { "1", "aaa", "A", "", "10" },
                { "2", "bbb", "B", "", "20" },
            }
        end
        if sql:find("MAX(start_time)", 1, true) then
            return FakeSqlite.resultSet{ { "1", "500" } }
        end
        return nil
    end)

    local session = Reader.openSession()
    local rows, last_id = session:bookRowsAfter(0, 50)
    assertEqual(#rows, 2, "a page of statistics rows comes back")
    assertEqual(last_id, 2, "the cursor advances to the highest id in the page")
    assertEqual(#session:bookRowsAfter(last_id, 50), 0, "the next page is empty")

    local latest = session:latestEventTimes()
    assertEqual(latest[1], 500, "the grouped query reports the newest event per row")
    assertEqual(latest[2], nil, "a row with no events is absent rather than zero")

    assertEqual(stats.opens, 1, "the session opens exactly one connection")
    assertEqual(stats.prepares, 2, "one prepared statement per query shape, reused across pages")
    session:close()
    assertEqual(stats.closes, 1, "closing the session releases the connection")

    assertEqual(session:latestEventTimes(), nil, "a closed session answers nothing rather than reopening")
end

print("bookorbit_stats_reader_test.lua: ok")
