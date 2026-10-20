--[[--
What is on each page of the widget dashboard, and where it is kept.

A board is four pages, each with one job: Home is now, Insights is the
longer view of your reading, Library is shelves and browsing, and Decor is
the pictures (a reading buddy, the chapter line, the moon). No widget
appears on two of them. The pages are defined per column count and, for four
columns, per orientation, so the same layout reads well on a phone, an
e-reader, a turned e-reader and a landscape tablet. The starter layouts
(Reader, Stats, Library) only change which of the first three comes first;
Decor is always last.

A reader who customizes a board gets their own pages stored for that screen
layout; until then the starter pages are computed fresh, so new widgets and
device differences (a frontlight or not) apply without a migration.

Stored under catalog_board, keyed by column count plus "l" in landscape:
  { version = 1, preset = "reader", tiles = "outline", started = true,
    custom = { ["4"] = { pages = { { items = {...} }, ... } }, ["4l"] = ... } }
]]

local _ = require("gettext")

local BoardStore = {}

BoardStore.SETTING_KEY = "catalog_board"
BoardStore.VERSION = 1
BoardStore.PRESETS = { "reader", "stats", "library" }
BoardStore.TILE_STYLES = { "outline", "soft", "ink" }
BoardStore.PAGE_COUNT = 4
BoardStore.PAGE_IDS = { "home", "insights", "library", "decor" }

local PAGE_NAMES = {
    home = function() return _("Home") end,
    insights = function() return _("Insights") end,
    library = function() return _("Library") end,
    decor = function() return _("Decor") end,
}

function BoardStore.pageName(id)
    return (PAGE_NAMES[id] or PAGE_NAMES.home)()
end

-- The names of a list of pages, in order.
function BoardStore.pageNames(pages)
    local names = {}
    for index = 1, BoardStore.PAGE_COUNT do
        local page = pages and pages[index]
        names[index] = BoardStore.pageName(page and page.id or BoardStore.PAGE_IDS[index])
    end
    return names
end

-- Shelf sources a shelf widget can show. Catalog selectors carry params.
BoardStore.SHELVES = {
    wtr = { source = "want-to-read" },
    upnext = { source = "up-next-in-series" },
    discover = { source = "random", shuffle = true },
    recent = { source = "recently-added" },
    progress = { source = "in-progress" },
    pickup = { source = "pick-back-up" },
    finished = { source = "finished" },
}

-- The key a shelf's books are stored under: its source, plus the filter for
-- shelves that show one library, collection, SmartScope, author or series.
function BoardStore.shelfKey(props)
    props = props or {}
    local source = props.source or "random"
    if type(props.params) ~= "table" then return source end
    local keys = {}
    for k in pairs(props.params) do table.insert(keys, k) end
    table.sort(keys)
    local parts = { source }
    for _i, k in ipairs(keys) do table.insert(parts, k .. "=" .. tostring(props.params[k])) end
    return table.concat(parts, ":")
end

local function L(type_, cw, rh, chrome, props)
    return { type = type_, cw = cw, rh = rh, chrome = chrome or "line", props = props }
end

local function link(kind)
    return L("link", 1, 1, "line", { link = kind })
end

local function links(kinds)
    local out = {}
    for _i, kind in ipairs(kinds) do table.insert(out, link(kind)) end
    return out
end

-- Shelves are never one row tall: a single row leaves covers too small to
-- recognise.
local function shelf(key, cw, rh)
    local props = {}
    for k, v in pairs(BoardStore.SHELVES[key]) do props[k] = v end
    return L("shelf", cw, rh, "line", props)
end

local function concat(...)
    local out = {}
    for _i, list in ipairs({ ... }) do
        for _i, it in ipairs(list) do table.insert(out, it) end
    end
    return out
end

-- The four starter pages for a screen layout, in the order the preset puts
-- them. has_light swaps the Library page's Light for a reading calendar on
-- devices without a frontlight.
function BoardStore.starterPages(cols, preset, has_light, landscape)
    -- The last Library row, dropped first on short screens.
    local function deviceRow(cw)
        return { L("clock", cw, 1, "ink"), has_light and L("light", cw, 1) or L("calendar", cw, 1) }
    end
    local home, insights, library, decor
    if cols == 2 then
        home = concat({ L("hero", 2, 2, "ink"), L("streak", 1, 1), L("week", 1, 1), L("goalpace", 1, 1), L("toggles", 1, 1), L("also", 2, 2),
            L("buddy", 2, 1), shelf("discover", 2, 2), L("highlight", 2, 1, "fill") }, links({ "library", "authors", "series", "device" }), { shelf("recent", 2, 2) })
        insights = { L("heatmap", 2, 2), L("forecast", 2, 1), L("hours", 2, 1), L("records", 2, 2), shelf("finished", 2, 2), L("yearago", 2, 1), L("word", 2, 1) }
        library = concat({ shelf("pickup", 2, 2), shelf("upnext", 2, 2), shelf("wtr", 2, 2) }, links({ "collections", "scopes", "search" }),
            { L("sync", 1, 1) }, deviceRow(2))
        decor = { L("chapters", 2, 2), L("analog", 1, 1, "ink"), L("moon", 1, 1, "ink"), L("badge", 2, 1), L("odometer", 2, 1),
            L("dust", 2, 1), L("rings", 2, 1), L("glyph", 2, 1) }
    elseif cols == 6 then
        home = concat({ L("hero", 2, 2, "ink"), L("streak", 1, 1), L("week", 1, 1), L("also", 2, 2), L("goalpace", 1, 1), L("toggles", 1, 1),
            L("buddy", 2, 1), L("highlight", 2, 1, "fill"), shelf("discover", 2, 2), shelf("recent", 2, 2) },
            links({ "library", "authors", "series", "collections", "scopes", "device" }))
        insights = { L("heatmap", 4, 2), L("records", 2, 2), L("forecast", 2, 1), L("hours", 2, 1), L("word", 2, 1), shelf("finished", 4, 2), L("yearago", 2, 2) }
        library = concat({ shelf("pickup", 4, 2), shelf("upnext", 2, 2), shelf("wtr", 4, 2) }, links({ "search" }), { L("sync", 1, 1), L("clock", 2, 1, "ink") })
        decor = { L("badge", 2, 2), L("rings", 2, 2), L("glyph", 2, 2), L("chapters", 6, 1), L("analog", 1, 1, "ink"), L("odometer", 2, 1), L("moon", 1, 1, "ink"), L("dust", 2, 1) }
    elseif landscape then
        home = concat({ L("hero", 2, 2, "ink"), L("streak", 1, 1), L("week", 1, 1), L("goalpace", 1, 1), L("toggles", 1, 1), L("also", 2, 2),
            shelf("discover", 2, 2) }, links({ "library", "authors", "series", "device" }))
        insights = { L("heatmap", 4, 2), L("forecast", 2, 1), L("hours", 2, 1), L("records", 2, 2), L("yearago", 2, 2) }
        library = concat({ shelf("pickup", 4, 2), shelf("upnext", 2, 2), shelf("wtr", 2, 2) }, links({ "collections", "scopes", "search" }), { L("sync", 1, 1) })
        decor = { L("buddy", 2, 2), L("chapters", 2, 2), L("analog", 1, 1, "ink"), L("odometer", 2, 1), L("moon", 1, 1, "ink"), L("badge", 2, 2), L("dust", 2, 1), L("glyph", 2, 1) }
    else
        home = concat({ L("hero", 2, 2, "ink"), L("streak", 1, 1), L("toggles", 1, 1), L("week", 1, 1), L("goalpace", 1, 1), L("also", 2, 2),
            L("buddy", 2, 1), L("highlight", 2, 1, "fill"), shelf("discover", 2, 2), shelf("recent", 2, 2) }, links({ "library", "authors", "series", "device" }))
        insights = { L("heatmap", 4, 2), L("forecast", 2, 1), L("hours", 2, 1), L("records", 2, 2), L("yearago", 2, 2), shelf("finished", 2, 2), L("word", 2, 2) }
        library = concat({ shelf("pickup", 4, 2), shelf("upnext", 2, 2), shelf("wtr", 2, 2) }, links({ "collections", "scopes", "search" }),
            { L("sync", 1, 1) }, deviceRow(2))
        decor = { L("chapters", 2, 2), L("badge", 2, 2), L("analog", 1, 1, "ink"), L("odometer", 2, 1), L("moon", 1, 1, "ink"),
            L("rings", 2, 2), L("dust", 2, 1), L("glyph", 2, 1) }
    end
    local pages = {
        home = { id = "home", base = home, extras = {} },
        insights = { id = "insights", base = insights, extras = {} },
        library = { id = "library", base = library, extras = {} },
        decor = { id = "decor", base = decor, extras = {} },
    }
    local order = { "home", "insights", "library" }
    if preset == "stats" then
        order = { "insights", "home", "library" }
    elseif preset == "library" then
        order = { "library", "home", "insights" }
    end
    return { pages[order[1]], pages[order[2]], pages[order[3]], pages.decor }
end

local function readState(settings)
    local stored = settings and settings[BoardStore.SETTING_KEY]
    if type(stored) ~= "table" or stored.version ~= BoardStore.VERSION then
        return { version = BoardStore.VERSION, preset = "reader", tiles = "outline", started = false, custom = {} }
    end
    local state = {
        version = BoardStore.VERSION,
        preset = stored.preset,
        tiles = stored.tiles,
        started = stored.started == true,
        custom = type(stored.custom) == "table" and stored.custom or {},
    }
    local valid_preset, valid_tiles = false, false
    for _i, p in ipairs(BoardStore.PRESETS) do valid_preset = valid_preset or p == state.preset end
    for _i, t in ipairs(BoardStore.TILE_STYLES) do valid_tiles = valid_tiles or t == state.tiles end
    if not valid_preset then state.preset = "reader" end
    if not valid_tiles then state.tiles = "outline" end
    return state
end

BoardStore.read = readState

-- A portrait and a landscape screen can share a column count but not a
-- height, so each keeps its own pages.
function BoardStore.layoutKey(cols, landscape)
    return tostring(cols) .. (landscape and "l" or "")
end

-- Pages saved before shelves had a two-row minimum still hold one-row shelves.
local function storedItem(it)
    if type(it) ~= "table" or it.type ~= "shelf" or (tonumber(it.rh) or 1) >= 2 then return it end
    local copy = {}
    for k, v in pairs(it) do copy[k] = v end
    copy.rh = 2
    return copy
end

-- The pages to draw for this screen: the reader's own, or the starter.
function BoardStore.pages(settings, cols, has_light, landscape)
    local state = readState(settings)
    local custom = state.custom[BoardStore.layoutKey(cols, landscape)]
    if type(custom) == "table" and type(custom.pages) == "table" and #custom.pages > 0 then
        local pages = {}
        local starter = nil
        for index = 1, BoardStore.PAGE_COUNT do
            local page = custom.pages[index]
            -- A board saved before the Decor page existed gets it as it starts.
            -- A Decor page the reader emptied is saved, so it stays empty.
            if page == nil and BoardStore.PAGE_IDS[index] == "decor" then
                starter = starter or BoardStore.starterPages(cols, state.preset, has_light, landscape)
                page = { id = starter[index].id, items = starter[index].base }
            end
            local items = {}
            if type(page) == "table" and type(page.items) == "table" then
                for _i, it in ipairs(page.items) do table.insert(items, storedItem(it)) end
            end
            local id = type(page) == "table" and PAGE_NAMES[page.id] and page.id or BoardStore.PAGE_IDS[index]
            pages[index] = { id = id, base = items, extras = {} }
        end
        return pages, true
    end
    return BoardStore.starterPages(cols, state.preset, has_light, landscape), false
end

-- Writes the reader's pages for one screen layout. Returns the new setting.
function BoardStore.withCustomPages(settings, cols, pages, landscape)
    local state = readState(settings)
    local out = { pages = {} }
    for index, page in ipairs(pages) do
        local items = {}
        for _i, it in ipairs(page.items or page.base or {}) do
            table.insert(items, { type = it.type, cw = it.cw, rh = it.rh, chrome = it.chrome, props = it.props })
        end
        out.pages[index] = { id = page.id, items = items }
    end
    state.custom[BoardStore.layoutKey(cols, landscape)] = out
    return state
end

function BoardStore.withPreset(settings, preset)
    local state = readState(settings)
    state.preset = preset
    state.started = true
    state.custom = {}
    return state
end

function BoardStore.withTiles(settings, tiles)
    local state = readState(settings)
    state.tiles = tiles
    return state
end

return BoardStore
