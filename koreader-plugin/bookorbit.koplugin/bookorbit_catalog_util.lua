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

CatalogUtil.DEFAULT_GRID_COLUMNS = 3
CatalogUtil.DEFAULT_GRID_ROWS = 3
CatalogUtil.THUMBNAIL_BATCH_SIZE = 2
CatalogUtil.MAX_RECENT_SEARCHES = 8
CatalogUtil.ON_DEVICE_MAX_IDS = 200

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
    { id = "want_to_read", text = _("To read") },
    { id = "reading", text = _("Reading") },
    { id = "on_hold", text = _("On hold") },
    { id = "read", text = _("Read") },
    { id = "abandoned", text = _("Abandoned") },
}

CatalogUtil.COMMON_FORMATS = { "epub", "pdf", "cbz", "cbr", "mobi", "azw3", "fb2", "djvu", "txt" }

CatalogUtil.GRID_PRESETS = {
    { 2, 2 }, { 2, 3 }, { 3, 3 }, { 3, 4 }, { 4, 4 }, { 4, 5 },
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
