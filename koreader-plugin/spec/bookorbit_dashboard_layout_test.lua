-- Proves the widget board's layout rules: the grid each screen width gets,
-- dense packing, that every starter page fits every supported screen, how
-- boards are stored, and that editing can never keep a page that does not fit.

package.loaded["gettext"] = function(text)
    return text
end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}
local shown = {}
package.loaded["ui/uimanager"] = {
    show = function(_, widget)
        table.insert(shown, widget)
    end,
}
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
-- Refusals are told in BookOrbit's pill; record them like a shown widget.
package.loaded["bookorbit_toast"] = {
    show = function(text) table.insert(shown, { text = text }) end,
    error = function(text) table.insert(shown, { text = text }) end,
}

-- The real metrics module over a stubbed screen, so each device below is
-- measured in board units exactly as it is on the device.
local screen = { w = 600, h = 800, dpi = 167 }
package.loaded["ffi/blitbuffer"] = setmetatable({}, { __index = function() return 0 end })
local last_face_size
package.loaded["ui/font"] = { getFace = function(_, _, size) last_face_size = size return {} end }
package.loaded["device"] = {
    screen = {
        getWidth = function() return screen.w end,
        getHeight = function() return screen.h end,
        getDPI = function() return screen.dpi end,
        scaleBySize = function(_, value)
            return math.ceil(value * math.min(screen.w, screen.h) / 600)
        end,
    },
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BoardMetrics = require("bookorbit_board_metrics")
local BoardLayout = require("bookorbit_board_layout")
local BoardStore = require("bookorbit_board_store")
local BoardEdit = require("bookorbit_board_edit")
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function px(value) return value end

assertEqual(BoardMetrics.get().scale, 1.05, "metrics start at the default size before settings load")

-- Size codes adapt to the column count: on a two-column board W is M and XL
-- is L.
local cw, rh = BoardLayout.sizeDims("W", 2)
assertEqual(cw .. "x" .. rh, "2x1", "W on two columns is M")
cw, rh = BoardLayout.sizeDims("XL", 6)
assertEqual(cw .. "x" .. rh, "6x2", "XL spans six columns")
cw, rh = BoardLayout.sizeDims("L", 4)
assertEqual(cw .. "x" .. rh, "2x2", "L is two by two")

assertEqual(BoardLayout.columnsFor(559), 2, "a phone-width screen gets two columns")
assertEqual(BoardLayout.columnsFor(560), 4, "an e-reader width gets four columns")
assertEqual(BoardLayout.columnsFor(899), 4, "four columns up to tablet width")
assertEqual(BoardLayout.columnsFor(900), 6, "a landscape tablet gets six columns")

-- The last column absorbs the rounding remainder, so a row of tiles always
-- ends exactly on the right margin.
for _, width in ipairs({ 600, 601, 637, 1001 }) do
    local g = BoardLayout.geometry(px, width, 900, width)
    local x, total = 0, 0
    while x < g.cols do
        total = total + BoardLayout.spanWidth(g, x, 1) + (x + 1 < g.cols and g.gap or 0)
        x = x + 1
    end
    assertEqual(total, g.w, "single tiles across a " .. width .. "px row fill it")
    assertEqual(BoardLayout.spanWidth(g, 0, g.cols), g.w, "a full-width tile spans the grid at " .. width .. "px")
end

-- Packing is first-fit and dense: a later small widget fills a hole left
-- beside an earlier wide one.
local packed = BoardLayout.pack({
    { type = "a", cw = 3, rh = 1 },
    { type = "b", cw = 2, rh = 1 },
    { type = "c", cw = 1, rh = 1 },
}, 4)
assertEqual(packed.placed[3].x .. "," .. packed.placed[3].y, "3,0", "the small widget fills the first-row hole")
assertEqual(packed.rows, 2, "two rows are used")
assertEqual(packed.holes, 2, "the half-empty last row counts as two holes")
assertEqual(BoardLayout.pack({ { cw = 9, rh = 1 } }, 4).placed[1].cw, 4, "a widget wider than the grid is clamped")

-- A page with more rows than fit drops widgets from its end; a page with room
-- takes extras that leave no new hole.
local g = BoardLayout.geometry(px, 600, 800, 600)
local base = {}
for _ = 1, 12 do table.insert(base, { type = "s", cw = 4, rh = 1 }) end
local fitted = BoardLayout.fitPage(g, base, {})
assertEqual(fitted.row_h >= g.min_row, true, "a crowded page keeps rows at least the minimum height")
assertEqual(#fitted.placed < 12, true, "a crowded page drops widgets from its end")
fitted = BoardLayout.fitPage(g, { { type = "a", cw = 4, rh = 1 } }, { { type = "extra", cw = 4, rh = 1 } })
assertEqual(#fitted.placed, 2, "a roomy page takes an extra")
assertEqual(fitted.row_h <= g.max_row, true, "rows never grow past the maximum height")

-- Every starter page of every layout fits every class of screen KOReader runs
-- on, upright and turned, with and without a frontlight: rows stay between
-- the minimum and maximum height and the grid never runs past its space.
local DEVICES = {
    { "Kindle 4", 600, 800, 167 },
    { "Kobo Mini", 600, 800, 200 },
    { "Kobo Clara", 1072, 1448, 300 },
    { "Kobo Libra", 1264, 1680, 300 },
    { "Palma", 824, 1648, 300 },
    { "Kobo Elipsa", 1404, 1872, 227 },
    { "Kindle Scribe", 1860, 2480, 300 },
    { "phone", 1080, 2400, 420 },
    { "small phone", 720, 1280, 320 },
    { "tablet", 1600, 2560, 320 },
}
local checked = 0
for _, device in ipairs(DEVICES) do
    for _, turned in ipairs({ false, true }) do
        screen.w, screen.h, screen.dpi = device[2], device[3], device[4]
        if turned then screen.w, screen.h = screen.h, screen.w end
        for _, ui_scale in ipairs(BoardMetrics.UI_SCALES) do
            BoardMetrics.setUserScale(ui_scale)
            local m = BoardMetrics.refresh()
            local sg = BoardLayout.geometry(BoardMetrics.px, m.w, m.h, m.W)
            for _, preset in ipairs(BoardStore.PRESETS) do
                for _, has_light in ipairs({ true, false }) do
                    for page_index, page in ipairs(BoardStore.starterPages(sg.cols, preset, has_light, m.w > m.h)) do
                        local label = string.format("%s page %d on %s%s at %.1fx",
                            preset, page_index, device[1], turned and " turned" or "", ui_scale)
                        local result = BoardLayout.fitPage(sg, page.base, page.extras)
                        assertEqual(result.row_h >= sg.min_row, true, label .. " keeps rows tall enough")
                        assertEqual(result.grid_h <= sg.avail, true, label .. " fits the screen")
                        for _, item in ipairs(result.placed) do
                            assertEqual(item.x + item.cw <= sg.cols, true,
                                label .. " keeps " .. item.type .. " inside the grid")
                        end
                        checked = checked + 1
                    end
                end
            end
        end
    end
end
assertEqual(checked, #DEVICES * 2 * #BoardMetrics.UI_SCALES * 3 * 2 * BoardStore.PAGE_COUNT,
    "every starter page was checked at every interface size")
screen.w, screen.h, screen.dpi = 600, 800, 167
BoardMetrics.setUserScale(1)
BoardMetrics.refresh()

BoardMetrics.setUserScale(1.2)
local scaled = BoardMetrics.refresh()
assertEqual(scaled.scale, 1.2, "the selected interface size is retained")
BoardMetrics.face(10)
assertEqual(last_face_size, 10 * scaled.adj * scaled.scale, "the selected interface size scales fonts")
BoardMetrics.namedFace("cfont", 11)
assertEqual(last_face_size, 11 * scaled.adj * scaled.scale, "named KOReader fonts use the same interface scale")
assertEqual(BoardMetrics.normalizeUserScale(1.149999), 1.15, "minor numeric drift is normalized")
assertEqual(BoardMetrics.normalizeUserScale(1.25), 1.2, "the retired interface size migrates to the supported maximum")
assertEqual(BoardMetrics.normalizeUserScale("1.25"), 1.2, "the retired persisted string size migrates")
assertEqual(BoardMetrics.DEFAULT_UI_SCALE, 1.05, "the default interface size is 1.05x")
assertEqual(BoardMetrics.normalizeUserScale(nil), 1.05, "missing preferences use the default size")
assertEqual(BoardMetrics.normalizeUserScale("invalid"), 1.05, "invalid preferences use the default size")
assertEqual(BoardMetrics.normalizeUserScale(1.17), 1.05, "unsupported interface sizes fall back safely")
assertEqual(BoardMetrics.normalizeUserScale(1), 1, "an explicit saved 1.0x preference is preserved")
BoardMetrics.setUserScale(1)
BoardMetrics.refresh()

-- Each page has one job: no widget appears on two pages, on any screen
-- layout, with or without a frontlight.
for _, cols in ipairs({ 2, 4, 6 }) do
    for _, landscape in ipairs({ false, true }) do
        for _, has_light in ipairs({ true, false }) do
            local seen = {}
            for _, page in ipairs(BoardStore.starterPages(cols, "reader", has_light, landscape)) do
                for _, list in ipairs({ page.base, page.extras }) do
                    for _, item in ipairs(list) do
                        local key = item.type .. ":" .. tostring(item.props and (item.props.source or item.props.link) or "")
                        assertEqual(seen[key] == nil or seen[key] == page.id, true,
                            key .. " appears on both " .. tostring(seen[key]) .. " and " .. page.id .. " (" .. cols .. " columns)")
                        seen[key] = page.id
                    end
                end
            end
        end
    end
end

-- The Stats and Library starters keep the same pages and only change which of
-- the first three comes first; Decor is always last.
local function ids(pages)
    local out = {}
    for i, page in ipairs(pages) do out[i] = page.id end
    return table.concat(out, ",")
end
assertEqual(ids(BoardStore.starterPages(4, "reader", true)), "home,insights,library,decor", "Reader opens on Home")
assertEqual(ids(BoardStore.starterPages(4, "stats", true)), "insights,home,library,decor", "Stats opens on Insights")
assertEqual(ids(BoardStore.starterPages(4, "library", true)), "library,home,insights,decor", "Library opens on Library")
assertEqual(table.concat(BoardStore.pageNames(BoardStore.starterPages(4, "stats", true)), ","), "Insights,Home,Library,Decor",
    "page names follow the pages")

-- A device without a frontlight never gets the Light widget.
for _, cols in ipairs({ 2, 4, 6 }) do
    for _, preset in ipairs(BoardStore.PRESETS) do
        for _, page in ipairs(BoardStore.starterPages(cols, preset, false)) do
            for _, list in ipairs({ page.base, page.extras }) do
                for _, item in ipairs(list) do
                    assertEqual(item.type ~= "light", true, preset .. " on " .. cols .. " columns has no Light without a frontlight")
                end
            end
        end
    end
end

-- A shelf is never one row tall, in a starter layout or as a size the editor
-- offers: a single row leaves covers too small to recognise.
for _, cols in ipairs({ 2, 4, 6 }) do
    for _, preset in ipairs(BoardStore.PRESETS) do
        for _, page in ipairs(BoardStore.starterPages(cols, preset, true)) do
            for _, list in ipairs({ page.base, page.extras }) do
                for _, item in ipairs(list) do
                    if item.type == "shelf" then
                        assertEqual(item.rh >= 2, true, preset .. " on " .. cols .. " columns keeps its shelves two rows tall")
                    end
                end
            end
        end
    end
end
for _, entry in ipairs(BoardEdit.LIBRARY) do
    if entry.type == "shelf" then
        for _, code in ipairs(entry.sizes) do
            local _cw, size_rh = BoardLayout.sizeDims(code, 4)
            assertEqual(size_rh >= 2, true, entry.name() .. " offers no one-row size")
        end
    end
end

-- Storage: anything unusable reads as the default Reader board.
local state = BoardStore.read({})
assertEqual(state.preset .. "/" .. state.tiles .. "/" .. tostring(state.started), "reader/outline/false", "no setting reads as the default")
state = BoardStore.read({ [BoardStore.SETTING_KEY] = { version = 1, preset = "nope", tiles = "neon", started = true } })
assertEqual(state.preset .. "/" .. state.tiles, "reader/outline", "unknown values fall back")
assertEqual(state.started, true, "a valid started flag survives")
state = BoardStore.read({ [BoardStore.SETTING_KEY] = { version = 99, preset = "stats" } })
assertEqual(state.preset, "reader", "a setting from another version is not trusted")

-- Custom pages are kept per column count; other counts still get the starter.
local settings = {}
settings[BoardStore.SETTING_KEY] = BoardStore.withPreset(settings, "stats")
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, {
    { items = { { type = "clock", cw = 1, rh = 1 } } },
})
local pages, custom = BoardStore.pages(settings, 4, true)
assertEqual(custom, true, "four columns use the reader's pages")
assertEqual(pages[1].base[1].type, "clock", "the stored widget is drawn")
assertEqual(#pages[2].base, 0, "a page the reader emptied stays empty")
pages, custom = BoardStore.pages(settings, 2, true)
assertEqual(custom, false, "two columns still use the starter layout")
settings[BoardStore.SETTING_KEY] = BoardStore.withPreset(settings, "library")
assertEqual(next(BoardStore.read(settings).custom), nil, "a new layout replaces the reader's pages")

-- Portrait and landscape can share a column count but not a height, so each
-- keeps its own pages.
settings = {}
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, {
    { items = { { type = "clock", cw = 1, rh = 1 } } },
}, true)
pages, custom = BoardStore.pages(settings, 4, true, true)
assertEqual(custom and pages[1].base[1].type, "clock", "landscape reads its own pages")
pages, custom = BoardStore.pages(settings, 4, true, false)
assertEqual(custom, false, "portrait keeps the starter layout")

-- A saved page keeps which page it is, so a Stats board stays named right.
settings = {}
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, {
    { id = "insights", items = {} }, { id = "home", items = {} }, { id = "library", items = {} },
})
pages = BoardStore.pages(settings, 4, true)
assertEqual(ids(pages), "insights,home,library,decor", "saved pages keep their ids")
-- A board saved before the Decor page existed gets it as it starts, and a
-- Decor page the reader emptied stays empty.
assertEqual(#pages[4].base > 0, true, "a three-page board gains the starter Decor page")
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, {
    { id = "insights", items = {} }, { id = "home", items = {} }, { id = "library", items = {} }, { id = "decor", items = {} },
})
pages = BoardStore.pages(settings, 4, true)
assertEqual(#pages[4].base, 0, "an emptied Decor page stays empty")
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, { { items = {} } })
assertEqual(BoardStore.pages(settings, 4, true)[1].id, "home", "pages saved before ids default by position")

-- Pages saved before shelves had a two-row minimum read back with two-row shelves.
settings = {}
settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(settings, 4, {
    { items = { { type = "shelf", cw = 4, rh = 1, props = { source = "random" } } } },
})
pages = BoardStore.pages(settings, 4, true)
assertEqual(pages[1].base[1].rh, 2, "a stored one-row shelf is drawn two rows tall")
assertEqual(BoardStore.read(settings).custom["4"].pages[1].items[1].rh, 1, "the stored setting itself is left alone")

-- A shelf's key is its source plus its filter, in a stable order.
assertEqual(BoardStore.shelfKey({ source = "random" }), "random", "a plain shelf keys by source")
assertEqual(BoardStore.shelfKey({ source = "authors", params = { sort = "title", author = "Le Guin" } }),
    "authors:author=Le Guin:sort=title", "filters are keyed in sorted order")
assertEqual(BoardStore.shelfKey(nil), "random", "a shelf without props is Discover")

-- Editing, on a four-column board.
local function newCatalog(opts)
    opts = opts or {}
    local catalog = {
        settings = opts.settings or {},
        inner_dimen = { w = opts.w or 600, h = opts.h or 800 },
        current_context = { kind = "dashboard", board_page = 1, dashboard = { boardShelves = {}, boardNames = {} } },
        redraws = 0,
        fetches = 0,
    }
    for name, fn in pairs(BoardEdit) do
        if type(fn) == "function" and name:match("^board") then catalog[name] = fn end
    end
    function catalog:menuChromeHeight() return 0, 0 end
    function catalog:dashboardMode() return true end
    function catalog:updateItems() self.redraws = self.redraws + 1 end
    function catalog:persistSetting(key, value) self.settings[key] = value end
    function catalog:boardHasLight() return true end
    function catalog:boardPages(cols) return BoardStore.pages(self.settings, cols, true) end
    function catalog:boardPage() return self.current_context.board_page end
    function catalog:boardSources() return {}, {} end
    function catalog:loadDashboardRoot() self.fetches = self.fetches + 1 end
    return catalog
end

local catalog = newCatalog()
catalog:boardEnterEdit()
local edit = catalog.board_edit
local eg = catalog:boardGeometry()
local items = edit.pages[1].items
local fitted_home = BoardLayout.fitPage(eg, BoardStore.starterPages(eg.cols, "reader", true)[1].base,
    BoardStore.starterPages(eg.cols, "reader", true)[1].extras)
assertEqual(#items, #fitted_home.placed, "editing starts from the starter page as drawn")

-- Earlier and Later swap neighbours.
local first, second = items[1].type, items[2].type
catalog:boardEditRun({ kind = "edit-select", index = 1 })
catalog:boardEditRun({ kind = "edit-move", delta = 1 })
assertEqual(items[1].type .. "," .. items[2].type, second .. "," .. first, "Later swaps with the next widget")
assertEqual(edit.selected, 2, "the selection follows the moved widget")

-- A size that would overflow the page is refused and the widget keeps its size.
shown = {}
local before = items[2].cw .. "x" .. items[2].rh
while catalog:boardPageFits(eg, items) do
    table.insert(items, { type = "week", cw = 4, rh = 1 })
end
table.remove(items)
assertEqual(catalog:boardPageFits(eg, items), true, "the page is filled to its limit")
catalog:boardEditRun({ kind = "edit-size", code = "XL" })
assertEqual(items[2].cw .. "x" .. items[2].rh, before, "an overflowing size is refused")
assertEqual(#shown, 1, "the reader is told why")
assertEqual(catalog:boardPageFits(eg, items), true, "the page still fits")

-- Adding to a full page is refused rather than squeezing the page.
shown = {}
local count = #items
catalog:boardEditRun({ kind = "sheet-add", entry = BoardEdit.entryFor({ type = "heatmap" }) })
assertEqual(#items, count, "a widget that cannot fit is not added")
assertEqual(#shown, 1, "the reader is told the page is full")

-- Moving to another page lands on the next page and leaves this one.
catalog:boardEditRun({ kind = "edit-select", index = 1 })
local moved = items[1]
local target_count = #edit.pages[2].items
catalog:boardEditRun({ kind = "edit-page" })
local dest = edit.pages[2].items
if dest[#dest] == moved then
    assertEqual(#dest, target_count + 1, "the widget lands on the next page")
    assertEqual(items[1] ~= moved, true, "and leaves this one")
else
    assertEqual(#dest, target_count, "a full next page refuses the widget")
end

-- Removing frees the room, and leaving edit mode stores the pages for this
-- column count and redraws once.
catalog:boardEditRun({ kind = "edit-remove", index = 1 })
assertEqual(edit.changed, true, "the board knows it was changed")
catalog:boardEditRun({ kind = "edit-done" })
assertEqual(catalog.board_edit, nil, "edit mode ends")
local stored = BoardStore.read(catalog.settings).custom[tostring(eg.cols)]
assertEqual(type(stored) == "table" and #stored.pages, BoardStore.PAGE_COUNT, "every page is stored for this column count")
assertEqual(catalog.fetches, 0, "nothing is fetched when the cache already holds what the board shows")

-- A saved page that no longer fits this screen opens in the editor as it is
-- drawn, so every change can still be checked against the page.
local crowded = {}
for _ = 1, 12 do table.insert(crowded, { type = "week", cw = 4, rh = 1 }) end
catalog = newCatalog()
catalog.settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages(catalog.settings, eg.cols, { { items = crowded } })
catalog:boardEnterEdit()
assertEqual(#catalog.board_edit.pages[1].items < 12, true, "the editor drops what the screen cannot show")
assertEqual(catalog:boardPageFits(eg, catalog.board_edit.pages[1].items), true, "the edited page fits")

-- Leaving without a change stores nothing.
catalog = newCatalog()
catalog:boardEnterEdit()
catalog:boardEditRun({ kind = "edit-done" })
assertEqual(next(BoardStore.read(catalog.settings).custom), nil, "an untouched board keeps the starter layout")

-- A shelf the board now shows but the cache lacks is fetched after the redraw.
catalog = newCatalog()
function catalog:boardSources() return { ["want-to-read"] = { source = "want-to-read" } }, {} end
catalog:boardRefreshIfMissing()
assertEqual(catalog.redraws, 1, "the board redraws first")
assertEqual(catalog.fetches, 1, "the missing shelf is fetched")
catalog.current_context.dashboard.boardShelves["want-to-read"] = {}
catalog:boardRefreshIfMissing()
assertEqual(catalog.fetches, 1, "a shelf the cache holds, even empty, is not fetched again")

-- Shelves picked on the old four-slot dashboard join the board once it has
-- started, and the old setting is dropped so this happens once.
local legacy = {
    { type = "stats" },
    { type = "continue-reading" },
    { type = "authors", sourceName = "Le Guin", params = { author = "Le Guin" } },
    { type = "browse" },
    schemaVersion = DashboardSections.SCHEMA_VERSION,
}
catalog = newCatalog({ settings = { [DashboardSections.SETTING_KEY] = legacy } })
assertEqual(catalog:boardMigrateLegacyShelves(), false, "nothing moves before the board has started")
assertEqual(catalog.settings[DashboardSections.SETTING_KEY] ~= nil, true, "the old setting waits for the start")
catalog.settings[BoardStore.SETTING_KEY] = BoardStore.withPreset(catalog.settings, "reader")
assertEqual(catalog:boardMigrateLegacyShelves(), true, "the migration runs once the board has started")
assertEqual(catalog.settings[DashboardSections.SETTING_KEY], nil, "the old setting is dropped")
local found
for _, page in ipairs(BoardStore.read(catalog.settings).custom[tostring(eg.cols)].pages) do
    for _, item in ipairs(page.items) do
        if item.type == "shelf" and item.props.source == "authors" then found = item end
    end
end
assertEqual(found and found.props.title, "Le Guin", "the picked author became a shelf")
assertEqual(found and found.props.params.author, "Le Guin", "the shelf keeps its filter")
assertEqual(catalog:boardMigrateLegacyShelves(), false, "the migration does not run twice")

assertEqual(BoardLayout.editBarTop(0, 300, 104, 24, 1300), 324, "sparse page toolbar stays below its first tile")
assertEqual(BoardLayout.editBarTop(1000, 250, 104, 24, 1300), 872, "bottom tile toolbar fits above")
assertEqual(BoardLayout.editBarTop(0, 250, 104, 24, 300), 0, "toolbar cannot escape above the grid")
for _, source in ipairs({ "libraries", "collections", "smart-scopes", "authors", "series" }) do
    local picked_entry = BoardEdit.entryFor({ type = "shelf", props = { source = source, params = { id = 1 } } })
    assertEqual(picked_entry and picked_entry.pick, true, "picked " .. source .. " shelf retains its library entry")
    assertEqual(table.concat(picked_entry.sizes, ","), "XL,L", "picked shelf retains both advertised sizes")
end

print("bookorbit_dashboard_layout_test.lua: ok")
