--[[--
Read-only access to KOReader's statistics.sqlite3.

Connections are short-lived and opened in read-only mode; the statistics
plugin owns all writes to this database.
]]

local DataStorage = require("datastorage")
local SQ3 = require("lua-ljsqlite3/init")
local logger = require("logger")

local BookOrbitStatsReader = {}

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

-- Returns an array of { md5, ids = {stat book row ids}, last_open, title }.
-- Multiple stats rows can share one md5 (the stats unique key is
-- title+authors+md5), so rows are grouped per md5 here.
function BookOrbitStatsReader.getBooks()
    return withConn(function(conn)
        local res = conn:exec("SELECT id, md5, title, last_open FROM book WHERE md5 IS NOT NULL AND md5 != '';")
        local by_md5 = {}
        local list = {}
        if res then
            for i = 1, #res[1] do
                local md5 = res[2][i]
                local entry = by_md5[md5]
                if not entry then
                    entry = { md5 = md5, ids = {}, last_open = 0, title = res[3][i] }
                    by_md5[md5] = entry
                    table.insert(list, entry)
                end
                table.insert(entry.ids, tonumber(res[1][i]))
                local last_open = tonumber(res[4][i]) or 0
                if last_open > entry.last_open then
                    entry.last_open = last_open
                end
            end
        end
        return list
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
