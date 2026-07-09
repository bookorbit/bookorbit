--[[--
Read-only access to KOReader's statistics.sqlite3.

Connections are short-lived and opened in read-only mode; the statistics
plugin owns all writes to this database.
]]

local DataStorage = require("datastorage")
local SQ3 = require("lua-ljsqlite3/init")
local logger = require("logger")

local BookOrbitStatsReader = {}

local function metadataKey(title, authors)
    return (title or "") .. "\0" .. (authors or "")
end

local function applyRow(entry, id, title, authors, last_open)
    if title == "" then title = nil end
    if authors == "" then authors = nil end
    table.insert(entry.ids, id)
    if not entry._variant_seen[metadataKey(title, authors)] then
        entry._variant_seen[metadataKey(title, authors)] = true
        entry._variant_count = entry._variant_count + 1
    end
    if last_open > (entry.last_open or 0) then
        entry.last_open = last_open
        if title then entry.title = title end
        if authors then entry.authors = authors end
    end
    if not entry.title and title then entry.title = title end
    if not entry.authors and authors then entry.authors = authors end
end

local function finalizeEntry(entry)
    entry.metadata_ambiguous = (entry._variant_count or 0) > 1
    entry._variant_seen = nil
    entry._variant_count = nil
    return entry
end

local function dbPath()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

local function withConn(fn)
    local ok_open, conn = pcall(SQ3.open, dbPath(), "ro")
    if not ok_open or not conn then
        logger.dbg("BookOrbit: cannot open statistics.sqlite3:", conn)
        return nil, "open_failed"
    end
    local ok, result = pcall(fn, conn)
    pcall(conn.close, conn)
    if not ok then
        logger.dbg("BookOrbit: statistics query failed:", result)
        return nil, "query_failed"
    end
    return result
end

-- Returns an array of { md5, ids = {stat book row ids}, last_open, title, authors }.
-- Multiple stats rows can share one md5 (the stats unique key is
-- title+authors+md5), so rows are grouped per md5 here.
function BookOrbitStatsReader.getBooks()
    return withConn(function(conn)
        local res = conn:exec("SELECT id, md5, title, authors, last_open FROM book WHERE md5 IS NOT NULL AND md5 != '';")
        local by_md5 = {}
        local list = {}
        if res then
            for i = 1, #res[1] do
                local md5 = res[2][i]
                local title = res[3][i]
                local authors = res[4][i]
                local entry = by_md5[md5]
                if not entry then
                    entry = { md5 = md5, ids = {}, last_open = 0, _variant_seen = {}, _variant_count = 0 }
                    by_md5[md5] = entry
                    table.insert(list, entry)
                end
                applyRow(entry, tonumber(res[1][i]), title, authors, tonumber(res[5][i]) or 0)
            end
        end
        for _, entry in ipairs(list) do
            finalizeEntry(entry)
        end
        return list
    end)
end

-- Returns { last_open, title, authors, metadata_ambiguous } for one md5,
-- merged the same way as getBooks(). Used by live single-book sync before
-- match-check.
function BookOrbitStatsReader.getBook(md5)
    if type(md5) ~= "string" or not md5:match("^%x+$") then return nil end
    return withConn(function(conn)
        local res = conn:exec(string.format("SELECT title, authors, last_open FROM book WHERE md5 = '%s';", md5))
        if not res then return nil end

        local book = { ids = {}, last_open = 0, _variant_seen = {}, _variant_count = 0 }
        for i = 1, #res[1] do
            local title = res[1][i]
            local authors = res[2][i]
            applyRow(book, i, title, authors, tonumber(res[3][i]) or 0)
        end
        if not book.title and not book.authors and book.last_open == 0 then return nil end
        finalizeEntry(book)
        book.ids = nil
        return book
    end)
end

-- Returns the stat book row ids sharing one md5 (the stats unique key is
-- title+authors+md5, so a single file can map to several rows).
function BookOrbitStatsReader.getBookIds(md5)
    if type(md5) ~= "string" or not md5:match("^%x+$") then return {} end
    local result = withConn(function(conn)
        local res = conn:exec(string.format("SELECT id FROM book WHERE md5 = '%s';", md5))
        local ids = {}
        if res then
            for i = 1, #res[1] do
                table.insert(ids, tonumber(res[1][i]))
            end
        end
        return ids
    end)
    return result or {}
end

-- Aggregated local reading activity for the dashboard stats strip: seconds
-- read today and over the past 7 days, plus the current daily reading streak
-- (consecutive days with any reading, still counting if today has none yet).
function BookOrbitStatsReader.getReadingSummary()
    return withConn(function(conn)
        local today = os.date("*t")
        today.hour, today.min, today.sec = 0, 0, 0
        local day_start = os.time(today)
        local function sumSince(start_time)
            local res = conn:exec(string.format(
                "SELECT COALESCE(SUM(MIN(duration, 86400)), 0) FROM page_stat_data WHERE start_time >= %d;",
                start_time))
            return res and tonumber(res[1][1]) or 0
        end

        local streak = 0
        local res = conn:exec(string.format(
            "SELECT DISTINCT date(start_time, 'unixepoch', 'localtime') FROM page_stat_data WHERE start_time >= %d;",
            day_start - 366 * 86400))
        if res then
            local days = {}
            for i = 1, #res[1] do
                days[res[1][i]] = true
            end
            local cursor = day_start
            if not days[os.date("%Y-%m-%d", cursor)] then
                cursor = cursor - 86400
            end
            while days[os.date("%Y-%m-%d", cursor)] do
                streak = streak + 1
                cursor = cursor - 86400
            end
        end

        return {
            today_seconds = sumSince(day_start),
            week_seconds = sumSince(day_start - 6 * 86400),
            streak_days = streak,
        }
    end)
end

-- Returns events newer than the watermark across all stat row ids of a book,
-- ordered by start_time. The caller handles batching via the limit.
function BookOrbitStatsReader.getEventsAfter(ids, watermark, limit)
    if not ids or #ids == 0 then return {} end
    return withConn(function(conn)
        local id_list = {}
        for _, id in ipairs(ids) do
            table.insert(id_list, string.format("%d", id))
        end
        local sql = string.format(
            "SELECT page, start_time, duration, total_pages FROM page_stat_data"
                .. " WHERE id_book IN (%s) AND start_time > %d AND total_pages > 0"
                .. " ORDER BY start_time, page LIMIT %d;",
            table.concat(id_list, ","),
            watermark or 0,
            limit
        )
        local res = conn:exec(sql)
        local events = {}
        if res then
            for i = 1, #res[1] do
                table.insert(events, {
                    page = tonumber(res[1][i]) or 0,
                    startTime = tonumber(res[2][i]) or 0,
                    durationSeconds = math.min(tonumber(res[3][i]) or 0, 86400),
                    totalPages = tonumber(res[4][i]) or 1,
                })
            end
        end
        return events
    end)
end

return BookOrbitStatsReader
