--[[--
Persistent local sync state for the BookOrbit plugin.

This LuaSettings file is the plugin's only local database. Matched books carry
full watermark records, unmatched hashes only a last-checked timestamp, so
thousands of unmatched books stay cheap. statistics.sqlite3 is never written.
]]

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local dump = require("dump")
local ffiutil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")

local STATE_FILE = "bookorbit_sync_state.lua"

local BookOrbitState = {}
BookOrbitState.__index = BookOrbitState

-- Conservative first value: a completely unchanged book still has to learn
-- once a day that its server-side file was deleted or re-imported. Tighten or
-- widen only against measured daily versus multi-day sync intervals.
BookOrbitState.MATCH_MAX_AGE = 24 * 3600

local function deepCopy(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do
        copy[deepCopy(key)] = deepCopy(item)
    end
    return copy
end

function BookOrbitState.open()
    local self = setmetatable({}, BookOrbitState)
    self:reload()
    return self
end

function BookOrbitState.snapshot(tables, flush_handler)
    return setmetatable({
        books = deepCopy(tables.books or {}),
        unmatched = deepCopy(tables.unmatched or {}),
        files = deepCopy(tables.files or {}),
        global = deepCopy(tables.global or {}),
        flush_handler = flush_handler,
    }, BookOrbitState)
end

-- Re-reads the settings file into this instance. Holders keep a valid
-- reference, so a reload cannot strand a caller on an orphaned snapshot it
-- would later flush over newer state.
function BookOrbitState:reload()
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/" .. STATE_FILE)
    self.settings = settings
    -- readSetting with a default persists the returned live table on flush.
    self.books = settings:readSetting("books", {})
    self.unmatched = settings:readSetting("unmatched", {})
    self.files = settings:readSetting("files", {})
    self.global = settings:readSetting("global", {})
    return self
end

function BookOrbitState:getBook(md5)
    return self.books[md5]
end

-- Maps BookOrbit bookId -> local file path and bookFileId -> local file path
-- for every matched book whose file is still present on disk. Both maps come
-- from one scan with one existence check per stored file; bookorbit_state_manager
-- caches the result so a catalog repaint never rescans the matched library.
function BookOrbitState:matchedFileMaps()
    local by_book_id, by_file_id = {}, {}
    for _, book in pairs(self.books) do
        local file = book.file
        if file and (book.bookId or book.fileId) and lfs.attributes(file, "mode") == "file" then
            if book.bookId then by_book_id[book.bookId] = file end
            if book.fileId then by_file_id[book.fileId] = file end
        end
    end
    return by_book_id, by_file_id
end

-- Every match-producing path funnels through here (lifecycle drain, open-book
-- match, sweep and the bulk manifest link), so this is the only place that can
-- stamp match freshness without leaving some path silently unfresh. The token
-- the match was verified against is stored alongside the time: without it a
-- single library change would force a request on every later book sync until
-- the user ran a full sweep.
function BookOrbitState:setMatched(md5, book_file_id, book_id, file, verified_version)
    local book = self.books[md5] or {}
    book.fileId = book_file_id
    book.bookId = book_id
    book.file = file or book.file
    book.statsWatermark = book.statsWatermark or 0
    book.annWatermark = book.annWatermark or ""
    book.annCount = book.annCount or 0
    book.matchVerifiedAt = os.time()
    book.matchVerifiedVersion = verified_version or (self.global and self.global.libraryVersion) or nil
    self.books[md5] = book
    self.unmatched[md5] = nil
end

-- Drops the freshness stamp so the next sync rechecks, used when the user
-- explicitly asks for a rematch.
function BookOrbitState.expireMatch(book)
    if not book then return end
    book.matchVerifiedAt = nil
    book.matchVerifiedVersion = nil
end

-- A match may be trusted without a request only inside a bounded age and, once
-- a library change has been observed, only when this book was verified against
-- the currently known token. A missing stamp is expired, so state written
-- before this existed rechecks once rather than being trusted forever.
function BookOrbitState.isMatchFresh(book, global, now)
    if not book then return false end
    local verified_at = book.matchVerifiedAt
    if type(verified_at) ~= "number" then return false end
    now = now or os.time()
    if verified_at > now or (now - verified_at) > BookOrbitState.MATCH_MAX_AGE then
        return false
    end
    global = global or {}
    if global.needsFullRecheck == true then
        local token = global.libraryVersion
        if token == nil or book.matchVerifiedVersion ~= token then return false end
    end
    return true
end

-- Single invalidation path for the library-version token. matchCheck and
-- sweepComplete call it `libraryVersion` and the bulk manifest calls it
-- `manifestVersion`, but both come from the same server-side computation, so
-- every carrier feeds this one function. Returns true when the token moved.
function BookOrbitState.applyLibraryVersion(state, version, now)
    if type(version) ~= "string" or version == "" then return false end
    local global = state.global
    local known = global.libraryVersion
    local changed = known ~= nil and version ~= known
    if changed then global.needsFullRecheck = true end
    global.libraryVersion = version
    global.libraryVersionCheckedAt = now or os.time()
    return changed
end

function BookOrbitState:setUnmatched(md5)
    self.books[md5] = nil
    self.unmatched[md5] = os.time()
end

function BookOrbitState:rememberFile(file, md5)
    if file and md5 then
        self.files[file] = md5
        local book = self.books[md5]
        if book and not book.file then
            book.file = file
        end
    end
end

function BookOrbitState:flush()
    if self.flush_handler then
        return self.flush_handler(self)
    end
    if self.settings.atomicFlush then
        local ok, err = self.settings:atomicFlush()
        if not ok then error(tostring(err or "state_flush_failed"), 0) end
    else
        local file = self.settings.file
        local temp = file .. ".bookorbit.tmp"
        local backup = file .. ".old"
        os.remove(temp)

        local serialized = "-- " .. temp .. "\nreturn "
            .. dump(self.settings.data, nil, true) .. "\n"
        local out, open_err = io.open(temp, "wb")
        if not out then error(tostring(open_err or "state_temp_open_failed"), 0) end
        local written, write_err = out:write(serialized)
        if not written then
            out:close()
            os.remove(temp)
            error(tostring(write_err or "state_temp_write_failed"), 0)
        end
        local flushed, flush_err = out:flush()
        if not flushed then
            out:close()
            os.remove(temp)
            error(tostring(flush_err or "state_temp_flush_failed"), 0)
        end
        local synced, sync_err = pcall(ffiutil.fsyncOpenedFile, out)
        local closed, close_err = out:close()
        if not synced or not closed then
            os.remove(temp)
            error(tostring(sync_err or close_err or "state_temp_sync_failed"), 0)
        end

        local had_current = lfs.attributes(file, "mode") == "file"
        if had_current then
            local backed_up, backup_err = os.rename(file, backup)
            if not backed_up then
                os.remove(temp)
                error(tostring(backup_err or "state_backup_failed"), 0)
            end
        end

        local published, publish_err = os.rename(temp, file)
        if not published then
            if had_current then os.rename(backup, file) end
            os.remove(temp)
            error(tostring(publish_err or "state_publish_failed"), 0)
        end
        pcall(ffiutil.fsyncDirectory, file)
    end
    -- bookorbit_state_manager installs this to publish a new generation, so
    -- derived caches invalidate no matter which plugin path wrote.
    if self.on_flush then self.on_flush(self) end
end

-- Shared ack-gated stats watermark advance used by the sweep and the per-book
-- sync. Returns true when a full batch went out and more events may remain.
function BookOrbitState.applyStatsAck(book, events, body, md5, batch_size, old_watermark)
    local server_watermark = old_watermark
    for _, result in ipairs(body.results or {}) do
        if result.hash == md5 and result.watermark then
            server_watermark = result.watermark
        end
    end

    if #events == batch_size then
        -- A full batch may have been cut inside a one-second group of events;
        -- back off by one second so the remainder is fetched next round
        -- (duplicates are server-side no-ops).
        local max_start = events[#events].startTime
        local next_watermark = max_start - 1
        if next_watermark <= old_watermark then
            next_watermark = server_watermark
        end
        book.statsWatermark = next_watermark
        return true
    end

    book.statsWatermark = server_watermark
    return false
end

return BookOrbitState
