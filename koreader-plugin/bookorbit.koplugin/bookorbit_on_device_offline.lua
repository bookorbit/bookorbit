--[[--
The On device list without the server. Its books are already on this device,
so offline the list is built here, whole, from what the device saved, and
paged here: opening it, turning pages and jumping by letter never ask for a
connection.

Pure functions: the catalog gathers the book paths, the saved entries and the
file metadata, and these turn them into the books page body the list draws.
]]

local ListData = require("bookorbit_list_data")

local OnDeviceOffline = {}

local function trim(value)
    if type(value) ~= "string" then return nil end
    value = value:match("^%s*(.-)%s*$")
    return value ~= "" and value or nil
end

-- "3,1,2" as numbers, in order, each once.
function OnDeviceOffline.parseIds(ids)
    local out, seen = {}, {}
    for part in tostring(ids or ""):gmatch("[^,]+") do
        local id = tonumber(part)
        if id and not seen[id] then
            seen[id] = true
            table.insert(out, id)
        end
    end
    return out
end

-- A list entry for a book no saved page holds: the title and authors KOReader
-- read from the file when it has opened it (props, its doc_props), otherwise
-- the file name. No cover, since none was saved for it.
function OnDeviceOffline.fileEntry(id, path, props)
    props = type(props) == "table" and props or {}
    local name = tostring(path or ""):match("([^/]+)$") or ""
    local stem, ext = name:match("^(.+)%.([^.]+)$")
    local authors = {}
    for author in tostring(props.authors or ""):gmatch("[^\n]+") do
        author = trim(author)
        if author then table.insert(authors, author) end
    end
    return {
        id = id,
        title = trim(props.title) or trim(stem) or trim(name) or tostring(id),
        authors = authors,
        formats = ext and { ext:lower() } or nil,
        hasCover = false,
    }
end

local function titleOrder(a, b)
    local la, lb = ListData.letterOf(a.title), ListData.letterOf(b.title)
    if la ~= lb then return la < lb end
    local ta, tb = tostring(a.title or ""):lower(), tostring(b.title or ""):lower()
    if ta ~= tb then return ta < tb end
    return (tonumber(a.id) or 0) < (tonumber(b.id) or 0)
end

-- The books page body for entries, sorted by title and grouped by first letter
-- the way the rail jumps. query: page or offset (0-based), as a server takes
-- them. size: books per screen.
function OnDeviceOffline.body(entries, query, size)
    local sorted = {}
    for i, entry in ipairs(entries or {}) do sorted[i] = entry end
    table.sort(sorted, titleOrder)
    size = math.max(1, math.floor(tonumber(size) or 1))
    local total = #sorted
    local page = math.max(1, math.floor(tonumber(query and query.page) or 1))
    local offset = tonumber(query and query.offset)
    local start = offset and math.max(0, math.floor(offset)) or (page - 1) * size
    local items = {}
    for i = start + 1, math.min(total, start + size) do table.insert(items, sorted[i]) end
    local buckets, seen = {}, {}
    for i, entry in ipairs(sorted) do
        local key = ListData.letterOf(entry.title)
        if not seen[key] then
            seen[key] = true
            table.insert(buckets, { key = key, index = i - 1 })
        end
    end
    return {
        items = items,
        total = total,
        page = page,
        size = size,
        offset = offset and start or nil,
        buckets = buckets,
        hasNext = start + size < total,
        hasPrevious = start > 0,
    }
end

return OnDeviceOffline
