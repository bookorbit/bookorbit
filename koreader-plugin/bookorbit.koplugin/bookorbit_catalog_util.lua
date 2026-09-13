--[[--
Pure helpers and constants for the BookOrbit catalog browser.

No widget construction and no dependency on the catalog instance; everything
here is stateless text/data formatting plus the shared lookup tables. Kept in
its own module so the catalog controller and its widgets can share it without
duplicating logic.
]]

local DocumentRegistry = require("document/documentregistry")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local CatalogUtil = {}

CatalogUtil.DEFAULT_GRID_COLUMNS = 4
CatalogUtil.DEFAULT_GRID_ROWS = 3
-- Covers fetched per background worker round. One subprocess covers the whole
-- batch and the page rebuilds once when it lands.
CatalogUtil.THUMBNAIL_BATCH_SIZE = 3
CatalogUtil.MAX_RECENT_SEARCHES = 8
-- The server caps its ids filter at 200, so both device-derived lists are
-- bounded by it rather than by the size of the library.
CatalogUtil.ON_DEVICE_MAX_IDS = 200
CatalogUtil.NOT_ON_DEVICE_MAX_IDS = 200
-- Not-on-device has no server-side filter, so the list is assembled by walking
-- the newest books. Both bounds keep that walk to a fixed number of requests
-- however large the library is.
CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES = 5
CatalogUtil.NOT_ON_DEVICE_SCAN_SIZE = 100

CatalogUtil.SORTS = {
    { id = "title", text = _("Title") },
    { id = "author", text = _("Author") },
    { id = "recently_added", text = _("Recently added") },
    { id = "recently_updated", text = _("Recently updated") },
    { id = "recently_read", text = _("Recently read") },
    { id = "series", text = _("Series order") },
}

CatalogUtil.SORT_LABELS = {
    title = _("Title"),
    author = _("Author"),
    recently_added = _("Recently added"),
    recently_updated = _("Recently updated"),
    recently_read = _("Recently read"),
    series = _("Series order"),
}

CatalogUtil.NATURAL_ORDER = {
    title = "asc",
    author = "asc",
    series = "asc",
    recently_added = "desc",
    recently_updated = "desc",
    recently_read = "desc",
}

CatalogUtil.SORT_KIND = {
    title = "alpha",
    author = "alpha",
    series = "alpha",
    recently_added = "time",
    recently_updated = "time",
    recently_read = "time",
}

CatalogUtil.DIRECTION_LABELS = {
    alpha = { asc = _("A-Z"), desc = _("Z-A") },
    time = { asc = _("oldest first"), desc = _("newest first") },
}

CatalogUtil.READ_STATUS_FILTERS = {
    { id = nil, text = _("All") },
    { id = "unread", text = _("Unread") },
    { id = "reading", text = _("Reading") },
    { id = "finished", text = _("Finished") },
}

CatalogUtil.READ_STATUS_LABELS = {
    unread = _("Unread"),
    want_to_read = _("To read"),
    reading = _("Reading"),
    on_hold = _("On hold"),
    rereading = _("Rereading"),
    read = _("Read"),
    skimmed = _("Skimmed"),
    abandoned = _("Abandoned"),
}

-- Read statuses the user can set from the catalog detail page. Kept in sync
-- with the server's manual read-status enum.
CatalogUtil.SETTABLE_READ_STATUSES = {
    { id = "unread", text = _("Unread") },
    { id = "want_to_read", text = _("To read") },
    { id = "reading", text = _("Reading") },
    { id = "on_hold", text = _("On hold") },
    { id = "read", text = _("Read") },
    { id = "abandoned", text = _("Abandoned") },
}

CatalogUtil.COMMON_FORMATS = { "epub", "pdf", "cbz", "cbr", "mobi", "azw3", "fb2", "djvu", "txt" }

CatalogUtil.GRID_PRESETS = {
    { 3, 3 }, { 4, 3 }, { 4, 4 }, { 5, 4 },
}

function CatalogUtil.isAuthError(err)
    return err == 401 or err == 403
end

function CatalogUtil.cloneParams(params)
    local copy = {}
    for key, value in pairs(params or {}) do
        copy[key] = value
    end
    return copy
end

function CatalogUtil.formatBytes(bytes)
    if not bytes then return "" end
    if bytes >= 1024 * 1024 then
        return string.format("%.1f MB", bytes / 1024 / 1024)
    elseif bytes >= 1024 then
        return string.format("%.0f KB", bytes / 1024)
    end
    return tostring(bytes) .. " B"
end

-- Browse badges sit in a narrow column beside the label, so a five-digit
-- library would eat the room the label needs. Counts stay at most four
-- characters. The scaled forms truncate rather than round, so a badge never
-- claims more than the library holds and 999999 cannot carry to "1000K".
function CatalogUtil.formatCount(value)
    local count = tonumber(value)
    if not count or count < 0 then return nil end
    count = math.floor(count)
    if count < 1000 then return tostring(count) end

    local function scaled(divisor, suffix)
        local units = count / divisor
        if units >= 10 then
            return string.format("%d%s", math.floor(units), suffix)
        end
        local tenths = math.floor(units * 10) / 10
        if tenths == math.floor(tenths) then
            return string.format("%d%s", tenths, suffix)
        end
        return string.format("%.1f%s", tenths, suffix)
    end

    if count < 1000000 then return scaled(1000, "K") end
    return scaled(1000000, "M")
end

function CatalogUtil.formatDuration(seconds)
    if not seconds then return nil end
    local minutes = math.floor(seconds / 60 + 0.5)
    if minutes < 60 then
        return T(_("%1 min"), minutes)
    end
    local hours = math.floor(minutes / 60)
    local remaining = minutes - hours * 60
    if remaining == 0 then
        return T(_("%1 h"), hours)
    end
    return T(_("%1 h %2 min"), hours, remaining)
end

function CatalogUtil.formatProgress(value)
    if not value then return nil end
    return tostring(math.floor(value + 0.5)) .. "%"
end

-- Parses an ISO-8601 UTC timestamp ("2026-07-30T12:34:56.000Z") to an epoch,
-- or nil for anything unparseable. os.time reads the fields as local time, so
-- the current UTC offset is added back.
local function parseIsoTimestamp(value)
    if type(value) ~= "string" then return nil end
    local year, month, day, hour, min, sec = value:match("^(%d%d%d%d)-(%d%d)-(%d%d)T(%d%d):(%d%d):(%d%d)")
    if not year then return nil end
    local as_local = os.time({
        year = tonumber(year),
        month = tonumber(month),
        day = tonumber(day),
        hour = tonumber(hour),
        min = tonumber(min),
        sec = tonumber(sec),
    })
    if not as_local then return nil end
    -- The probe table must infer DST exactly like the parsed table above did
    -- (os.date("!*t") pins isdst=false, which skews zones currently in DST by
    -- an hour), so both conversions share the same offset.
    local probe = os.date("!*t")
    probe.isdst = nil
    local offset = os.time() - os.time(probe)
    return as_local + offset
end

-- A coarse relative label for a UTC timestamp: "just now", "12 min ago",
-- "3 h ago", "yesterday", "5 days ago". Nil when the value cannot be parsed.
function CatalogUtil.formatRelativeTime(value, now)
    local timestamp = parseIsoTimestamp(value)
    if not timestamp then return nil end
    now = now or os.time()
    local delta = now - timestamp
    if delta < 0 then delta = 0 end
    if delta < 60 then
        return _("just now")
    end
    if delta < 3600 then
        return T(_("%1 min ago"), math.floor(delta / 60))
    end
    if delta < 86400 then
        return T(_("%1 h ago"), math.floor(delta / 3600))
    end
    local days = math.floor(delta / 86400)
    if days == 1 then
        return _("yesterday")
    end
    return T(_("%1 days ago"), days)
end

function CatalogUtil.readingStreakDays(dashboard, fallback)
    local reading_streak = dashboard and dashboard.readingStreak
    local current_streak = reading_streak and tonumber(reading_streak.currentStreak)
    if current_streak then return current_streak end
    return tonumber(fallback) or 0
end

function CatalogUtil.formatRating(value)
    if not value then return nil end
    if value == math.floor(value) then
        return tostring(value) .. "/5"
    end
    return string.format("%.1f/5", value)
end

function CatalogUtil.isSupportedFormat(format)
    return format and DocumentRegistry:hasProvider("dummy." .. string.lower(format))
end

function CatalogUtil.shortText(text, max_len)
    text = tostring(text or "")
    if #text <= max_len then return text end
    return util.fixUtf8(text:sub(1, max_len - 3), "?") .. "..."
end

-- Walks the newest books through fetchPage(page) and keeps the ids isOnDevice
-- rejects. There is no server-side filter for this: which books are linked is
-- local KOReader state the server never sees, so the walk is bounded by both
-- the page count and the server's cap on the ids filter to stay predictable on
-- a large library. Returns nil plus the fetch error if a page fails.
function CatalogUtil.scanNotOnDeviceIds(fetchPage, isOnDevice)
    local ids = {}
    for page = 1, CatalogUtil.NOT_ON_DEVICE_SCAN_PAGES do
        local body, err = fetchPage(page)
        if not body then return nil, err end
        for _, book in ipairs(body.items or {}) do
            if book.id ~= nil and not isOnDevice(book) then
                table.insert(ids, book.id)
                if #ids >= CatalogUtil.NOT_ON_DEVICE_MAX_IDS then return ids end
            end
        end
        if body.hasNext ~= true then break end
    end
    return ids
end

-- Paths carry their meaning at the end, so an over-long one keeps its tail
-- rather than its root the way shortText would.
function CatalogUtil.shortPath(path, max_len)
    path = tostring(path or "")
    if #path <= max_len then return path end
    return "..." .. util.fixUtf8(path:sub(#path - max_len + 4), "?")
end

function CatalogUtil.joinNames(items, key)
    local names = {}
    for _, item in ipairs(items or {}) do
        table.insert(names, key and item[key] or item)
    end
    return #names > 0 and table.concat(names, ", ") or nil
end

local HTML_ENTITIES = {
    amp = "&",
    apos = "'",
    bull = "*",
    eacute = "e",
    hellip = "...",
    ldquo = "\"",
    lsquo = "'",
    lt = "<",
    mdash = " - ",
    nbsp = " ",
    ndash = " - ",
    quot = "\"",
    rdquo = "\"",
    gt = ">",
    rsquo = "'",
}

local NUMERIC_ENTITIES = {
    [160] = " ",
    [8211] = " - ",
    [8212] = " - ",
    [8216] = "'",
    [8217] = "'",
    [8220] = "\"",
    [8221] = "\"",
    [8226] = "*",
    [8230] = "...",
}

local function decodeHtmlEntity(entity)
    local named = HTML_ENTITIES[entity:lower()]
    if named then return named end

    local code = entity:match("^#(%d+)$")
    if code then
        code = tonumber(code)
    else
        local hex_code = entity:match("^#x(%x+)$") or entity:match("^#X(%x+)$")
        code = hex_code and tonumber(hex_code, 16) or nil
    end
    if not code then return "&" .. entity .. ";" end

    local replacement = NUMERIC_ENTITIES[code]
    if replacement then return replacement end
    if code >= 32 and code <= 126 then
        return string.char(code)
    end
    return ""
end

function CatalogUtil.decodeHtmlEntities(text)
    return text:gsub("&(#?[xX]?%w+);", decodeHtmlEntity)
end

function CatalogUtil.cleanInlineText(text)
    text = tostring(text or "")
    text = text:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    return text ~= "" and text or nil
end

function CatalogUtil.cleanDescriptionText(text)
    text = tostring(text or "")
    text = CatalogUtil.decodeHtmlEntities(text)
    text = text:gsub("\r\n", "\n"):gsub("\r", "\n")
    text = text:gsub("<%s*[Bb][Rr]%s*/?%s*>", "\n")
    text = text:gsub("<%s*/%s*[Pp]%s*>", "\n\n")
    text = text:gsub("<%s*[Pp][^>]*>", "")
    text = text:gsub("<%s*/%s*[Dd][Ii][Vv]%s*>", "\n\n")
    text = text:gsub("<%s*[Dd][Ii][Vv][^>]*>", "")
    text = text:gsub("<%s*/%s*[Ll][Ii]%s*>", "\n")
    text = text:gsub("<%s*[Ll][Ii][^>]*>", "* ")
    text = text:gsub("<[^>]+>", "")
    text = CatalogUtil.decodeHtmlEntities(text)
    text = text:gsub("[ \t]+", " ")
    text = text:gsub(" *\n *", "\n")
    text = text:gsub("\n\n\n+", "\n\n")
    text = text:gsub("^%s+", ""):gsub("%s+$", "")
    return text ~= "" and text or nil
end

function CatalogUtil.formatSeries(book)
    if not book.seriesName then return nil end
    if book.seriesIndex then
        return book.seriesName .. " #" .. tostring(book.seriesIndex)
    end
    return book.seriesName
end

function CatalogUtil.firstAuthor(book)
    return book.authors and book.authors[1] or nil
end

function CatalogUtil.safeFilenameBase(detail)
    local title = detail.title or ("book-" .. tostring(detail.id))
    local author = CatalogUtil.firstAuthor(detail)
    local base = author and (title .. " - " .. author) or title
    base = base:gsub("[\"\\/:*?<>|]+", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    if base == "" then base = "book-" .. tostring(detail.id) end
    return base
end

function CatalogUtil.transferErrorText(err)
    if err == "unsafe_destination" then
        return _("The download destination is outside the selected folder.")
    elseif err == "temp_dir_failed" then
        return _("Could not create a temporary download folder in the selected folder.")
    end
    return nil
end

function CatalogUtil.coverLabel(book)
    local lines = {}
    local title = book and book.title or _("Untitled")
    table.insert(lines, CatalogUtil.shortText(title, 34))
    local author = book and CatalogUtil.firstAuthor(book)
    if author then
        table.insert(lines, CatalogUtil.shortText(author, 28))
    end
    return table.concat(lines, "\n")
end

return CatalogUtil
