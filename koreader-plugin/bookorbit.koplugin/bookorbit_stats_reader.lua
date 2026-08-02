--[[--
Read-only access to KOReader's statistics.sqlite3.

One-shot helpers open a short-lived connection; the sweep instead holds a
session for its whole run through openSession(), reusing one connection and its
prepared statements. Every query runs in autocommit and no transaction is ever
opened, so a chunked phase can yield between queries without blocking the
statistics plugin's writes or WAL checkpointing. The statistics plugin owns all
writes to this database.
]]

local DataStorage = require("datastorage")
local SQ3 = require("lua-ljsqlite3/init")
local logger = require("logger")

local unpack = table.unpack or unpack

local BookOrbitStatsReader = {}

local BUSY_TIMEOUT_MS = 1000
-- One cached statement per shape. The event query's shape varies with the
-- number of statistics rows a book has, so the cache is bounded and anything
-- beyond it runs as a transient statement.
local MAX_CACHED_STATEMENTS = 16

local BOOK_ROWS_SQL = "SELECT id, md5, title, authors, last_open FROM book"
    .. " WHERE md5 IS NOT NULL AND md5 != '' AND id > ? ORDER BY id LIMIT ?;"
local BOOK_BY_MD5_SQL = "SELECT id, title, authors, last_open FROM book WHERE md5 = ?;"
local BOOK_IDS_SQL = "SELECT id FROM book WHERE md5 = ?;"
local LATEST_EVENTS_SQL = "SELECT id_book, MAX(start_time) FROM page_stat_data"
    .. " WHERE total_pages > 0 GROUP BY id_book;"

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

local function openConn()
    local ok, conn = pcall(SQ3.open, dbPath(), "ro")
    if not ok or not conn then
        logger.dbg("BookOrbit: cannot open statistics.sqlite3:", conn)
        return nil
    end
    pcall(conn.set_busy_timeout, conn, BUSY_TIMEOUT_MS)
    return conn
end

local Session = {}
Session.__index = Session

-- Opens the shared read-only connection. A busy database is the expected
-- transient failure here, so one reopen is attempted before giving up.
function BookOrbitStatsReader.openSession()
    local conn = openConn() or openConn()
    if not conn then return nil, "open_failed" end
    return setmetatable({ conn = conn, statements = {}, statement_count = 0 }, Session)
end

function Session:close()
    for _, stmt in pairs(self.statements) do
        pcall(stmt.close, stmt)
    end
    self.statements = {}
    self.statement_count = 0
    if self.conn then
        pcall(self.conn.close, self.conn)
        self.conn = nil
    end
end

function Session:_reopen()
    self:close()
    self.conn = openConn()
    return self.conn ~= nil
end

function Session:_select(sql, params)
    local stmt = self.statements[sql]
    local transient = false
    if stmt then
        stmt:reset()
    else
        stmt = self.conn:prepare(sql)
        if self.statement_count < MAX_CACHED_STATEMENTS then
            self.statements[sql] = stmt
            self.statement_count = self.statement_count + 1
        else
            transient = true
        end
    end
    if params then
        stmt:bind(unpack(params))
    end
    local res = stmt:resultset("i")
    if transient then pcall(stmt.close, stmt) end
    return res
end

-- Returns the column-major result set, nil when the query matched no rows, or
-- nil plus an error when it failed after one reopen and retry.
function Session:select(sql, params)
    if not self.conn then return nil, "closed" end
    local ok, res = pcall(self._select, self, sql, params)
    if ok then return res end
    logger.dbg("BookOrbit: statistics query failed, reopening:", res)
    if not self:_reopen() then return nil, "open_failed" end
    local retried, retry_res = pcall(self._select, self, sql, params)
    if retried then return retry_res end
    logger.dbg("BookOrbit: statistics query failed:", retry_res)
    return nil, "query_failed"
end

-- Keyset pagination over the primary key, so a full-library enumeration can be
-- split into bounded chunks without an offset rescan. Returns the rows and the
-- id to continue from.
function Session:bookRowsAfter(after_id, limit)
    after_id = after_id or 0
    local rows = {}
    local res = self:select(BOOK_ROWS_SQL, { after_id, limit })
    if not res then return rows, after_id end
    for i = 1, #res[1] do
        local id = tonumber(res[1][i]) or 0
        table.insert(rows, {
            id = id,
            md5 = res[2][i],
            title = res[3][i],
            authors = res[4][i],
            last_open = tonumber(res[5][i]) or 0,
        })
        if id > after_id then after_id = id end
    end
    return rows, after_id
end

function Session:book(md5)
    if type(md5) ~= "string" or not md5:match("^%x+$") then return nil end
    local res = self:select(BOOK_BY_MD5_SQL, { md5 })
    if not res then return nil end
    local book = { ids = {}, last_open = 0, _variant_seen = {}, _variant_count = 0 }
    for i = 1, #res[1] do
        applyRow(book, tonumber(res[1][i]), res[2][i], res[3][i], tonumber(res[4][i]) or 0)
    end
    if #book.ids == 0 then return nil end
    return finalizeEntry(book)
end

function Session:bookIds(md5)
    if type(md5) ~= "string" or not md5:match("^%x+$") then return {} end
    local ids = {}
    local res = self:select(BOOK_IDS_SQL, { md5 })
    if res then
        for i = 1, #res[1] do
            table.insert(ids, tonumber(res[1][i]))
        end
    end
    return ids
end

-- Latest event time per statistics row, in one query. Books whose watermark
-- already covers their latest event can then be skipped without a per-book
-- event query. Returns nil when the query failed, so callers fall back to
-- asking per book rather than silently skipping every book.
function Session:latestEventTimes()
    local res, err = self:select(LATEST_EVENTS_SQL)
    if err then return nil end
    local latest = {}
    if res then
        for i = 1, #res[1] do
            latest[tonumber(res[1][i]) or 0] = tonumber(res[2][i]) or 0
        end
    end
    return latest
end

local function eventsSql(count)
    local marks = {}
    for _ = 1, count do
        table.insert(marks, "?")
    end
    return "SELECT page, start_time, duration, total_pages FROM page_stat_data"
        .. " WHERE id_book IN (" .. table.concat(marks, ",") .. ")"
        .. " AND start_time > ? AND total_pages > 0 ORDER BY start_time, page LIMIT ?;"
end

-- Events newer than the watermark across all statistics rows of a book,
-- ordered by start_time. The caller handles batching via the limit.
function Session:eventsAfter(ids, watermark, limit)
    if not ids or #ids == 0 then return {} end
    local params = {}
    for _, id in ipairs(ids) do
        table.insert(params, id)
    end
    table.insert(params, watermark or 0)
    table.insert(params, limit)

    local events = {}
    local res = self:select(eventsSql(#ids), params)
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
end

-- Aggregated local reading activity for the dashboard stats strip: seconds
-- read today, over the past 7 days and per day of that week, plus the current
-- daily reading streak (consecutive days with any reading, still counting if
-- today has none yet).
function Session:readingSummary()
    local today = os.date("*t")
    today.hour, today.min, today.sec = 0, 0, 0
    local day_start = os.time(today)
    local function sumSince(start_time)
        local res = self:select(
            "SELECT COALESCE(SUM(MIN(duration, 86400)), 0) FROM page_stat_data WHERE start_time >= ?;",
            { start_time })
        return res and tonumber(res[1][1]) or 0
    end

    -- Per-day totals for the strip's activity bars, oldest first, today last.
    local day_seconds = { 0, 0, 0, 0, 0, 0, 0 }
    local week_start = day_start - 6 * 86400
    local day_res = self:select(
        "SELECT date(start_time, 'unixepoch', 'localtime'), COALESCE(SUM(MIN(duration, 86400)), 0)"
            .. " FROM page_stat_data WHERE start_time >= ? GROUP BY 1;",
        { week_start })
    if day_res then
        local index_by_date = {}
        for day = 1, 7 do
            index_by_date[os.date("%Y-%m-%d", week_start + (day - 1) * 86400)] = day
        end
        for i = 1, #day_res[1] do
            local day = index_by_date[day_res[1][i]]
            if day then day_seconds[day] = tonumber(day_res[2][i]) or 0 end
        end
    end

    local streak = 0
    local res = self:select(
        "SELECT DISTINCT date(start_time, 'unixepoch', 'localtime') FROM page_stat_data WHERE start_time >= ?;",
        { day_start - 366 * 86400 })
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
        day_seconds = day_seconds,
        streak_days = streak,
    }
end

local function withSession(fn)
    local session = BookOrbitStatsReader.openSession()
    if not session then return nil, "open_failed" end
    local ok, result = pcall(fn, session)
    session:close()
    if not ok then
        logger.dbg("BookOrbit: statistics query failed:", result)
        return nil, "query_failed"
    end
    return result
end

-- Multiple statistics rows can share one md5 (the unique key is
-- title+authors+md5), so rows are grouped per md5. The sweep enumerates in
-- chunks and therefore drives the collector itself; a group is only complete
-- once every page has been added.
function BookOrbitStatsReader.newBookCollector()
    return { by_md5 = {}, list = {} }
end

function BookOrbitStatsReader.collectBookRow(collector, row)
    local entry = collector.by_md5[row.md5]
    if not entry then
        entry = { md5 = row.md5, ids = {}, last_open = 0, _variant_seen = {}, _variant_count = 0 }
        collector.by_md5[row.md5] = entry
        table.insert(collector.list, entry)
    end
    applyRow(entry, row.id, row.title, row.authors, row.last_open)
    return entry
end

function BookOrbitStatsReader.collectedEntries(collector)
    return collector.list
end

function BookOrbitStatsReader.finalizeBookEntry(entry)
    return finalizeEntry(entry)
end

-- Returns { ids, last_open, title, authors, metadata_ambiguous } for one md5.
-- Used by live single-book sync before match-check.
function BookOrbitStatsReader.getBook(md5)
    return withSession(function(session)
        return session:book(md5)
    end)
end

-- Identity cache for the currently open book. The close and suspend handlers
-- run on a hard latency budget, so they must not open statistics.sqlite3 to
-- learn the row ids; the cache is primed once the reader is ready instead.
-- Only stable identity fields live here. A miss is normal (a first open can
-- capture before the statistics row exists) and resolves through getBookIds().
local identity_cache

function BookOrbitStatsReader.primeIdentity(md5)
    if type(md5) ~= "string" or md5 == "" then return nil end
    if identity_cache and identity_cache.md5 == md5 then
        return identity_cache.book
    end
    local book = BookOrbitStatsReader.getBook(md5)
    identity_cache = { md5 = md5, book = book }
    return book
end

-- Returns the cached entry plus whether the digest was cached at all, so a
-- caller can tell "no statistics row" from "never looked up".
function BookOrbitStatsReader.cachedIdentity(md5)
    if identity_cache and identity_cache.md5 == md5 then
        return identity_cache.book, true
    end
    return nil, false
end

function BookOrbitStatsReader.forgetIdentity()
    identity_cache = nil
end

-- Returns the stat book row ids sharing one md5 (the stats unique key is
-- title+authors+md5, so a single file can map to several rows).
function BookOrbitStatsReader.getBookIds(md5)
    local result = withSession(function(session)
        return session:bookIds(md5)
    end)
    return result or {}
end

function BookOrbitStatsReader.getReadingSummary()
    return withSession(function(session)
        return session:readingSummary()
    end)
end

function BookOrbitStatsReader.getEventsAfter(ids, watermark, limit)
    if not ids or #ids == 0 then return {} end
    return withSession(function(session)
        return session:eventsAfter(ids, watermark, limit)
    end)
end

return BookOrbitStatsReader
