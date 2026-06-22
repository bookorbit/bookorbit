--[[--
Persistent local sync state for the BookOrbit plugin.

This LuaSettings file is the plugin's only local database. Matched books carry
full watermark records, unmatched hashes only a last-checked timestamp, so
thousands of unmatched books stay cheap. statistics.sqlite3 is never written.
]]

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local lfs = require("libs/libkoreader-lfs")

local STATE_FILE = "bookorbit_sync_state.lua"

local BookOrbitState = {}
BookOrbitState.__index = BookOrbitState

function BookOrbitState.open()
    local settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/" .. STATE_FILE)
    local self = setmetatable({ settings = settings }, BookOrbitState)
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

-- Maps BookOrbit bookId -> local file path for every matched book whose file is
-- still present on disk. Powers the catalog "on device" badges and shortcut.
function BookOrbitState:matchedByBookId()
    local result = {}
    for _, book in pairs(self.books) do
        if book.bookId and book.file and lfs.attributes(book.file, "mode") == "file" then
            result[book.bookId] = book.file
        end
    end
    return result
end

function BookOrbitState:matchedByBookFileId()
    local result = {}
    for _, book in pairs(self.books) do
        if book.fileId and book.file and lfs.attributes(book.file, "mode") == "file" then
            result[book.fileId] = book.file
        end
    end
    return result
end

function BookOrbitState:setMatched(md5, book_file_id, book_id, file)
    local book = self.books[md5] or {}
    book.fileId = book_file_id
    book.bookId = book_id
    book.file = file or book.file
    book.statsWatermark = book.statsWatermark or 0
    book.annWatermark = book.annWatermark or ""
    book.annCount = book.annCount or 0
    self.books[md5] = book
    self.unmatched[md5] = nil
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
    self.settings:flush()
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
