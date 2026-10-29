--[[--
Customizing the widget dashboard.

Hold any widget (or choose Customize dashboard in the menu) to edit. A tap
selects a widget and shows its bar: Earlier, Later, Size, Page and Remove.
There is no dragging, so editing works on e-ink and on D-pad devices alike.
Add widget opens a sheet of live previews.

The first edit turns the starter layout into the reader's own pages for this
column count. Every change is checked against the board's smallest row
height before it is kept, so a page can never hold more than fits.
]]

local T = require("ffi/util").template
local _ = require("gettext")

local BoardLayout = require("bookorbit_board_layout")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardStore = require("bookorbit_board_store")

local px = BoardMetrics.px

local BoardEdit = {}

-- The widgets a reader can add. Sizes are the codes in BoardLayout.sizeDims;
-- the first is the size a new widget gets.
BoardEdit.LIBRARY = {
    { type = "forecast", name = function() return _("Finish forecast") end, desc = function() return _("When your book ends at your pace") end, sizes = { "M", "S", "L" }, tab = "reading", new = true },
    { type = "heatmap", name = function() return _("Year in reading") end, desc = function() return _("One square a day for a whole year") end, sizes = { "XL", "L" }, tab = "stats", new = true },
    { type = "goalpace", name = function() return _("Goal pace") end, desc = function() return _("Ahead or behind on your yearly goal") end, sizes = { "M", "S" }, tab = "stats", new = true },
    { type = "light", name = function() return _("Light") end, desc = function() return _("Brightness and warmth steppers") end, sizes = { "M", "S" }, tab = "device", new = true },
    { type = "word", name = function() return _("Word of the day") end, desc = function() return _("A word you looked up, in context") end, sizes = { "M", "L" }, tab = "reading", new = true },
    { type = "yearago", name = function() return _("A year ago") end, desc = function() return _("What you were reading last year") end, sizes = { "M", "L" }, tab = "reading", new = true },
    { type = "toggles", name = function() return _("Quick settings") end, desc = function() return _("Wi-Fi, light, night mode, rotate, sync") end, sizes = { "M", "S" }, tab = "device", new = true },
    { type = "records", name = function() return _("Reading records") end, desc = function() return _("Your longest and average sessions") end, sizes = { "L", "M" }, tab = "stats", new = true },
    { type = "hours", name = function() return _("When you read") end, desc = function() return _("Your reading by hour of the day") end, sizes = { "M", "L" }, tab = "stats", new = true },
    { type = "shelf", name = function() return _("Finished this year") end, desc = function() return _("Covers of the books you finished") end, sizes = { "L", "XL" }, tab = "stats", new = true, props = { source = "finished" } },
    { type = "shelf", name = function() return _("Pick back up") end, desc = function() return _("Books you put down a while ago") end, sizes = { "XL", "L" }, tab = "library", new = true, props = { source = "pick-back-up" } },
    { type = "shelf", name = function() return _("Want to read") end, desc = function() return _("Books waiting for their turn") end, sizes = { "L", "XL" }, tab = "library", new = true, props = { source = "want-to-read" } },
    { type = "hero", name = function() return _("Continue reading") end, desc = function() return _("Your current book with Resume") end, sizes = { "W", "M", "L" }, tab = "reading", chrome = "ink" },
    { type = "also", name = function() return _("Also reading") end, desc = function() return _("The rest of your pile") end, sizes = { "L", "M" }, tab = "reading" },
    { type = "highlight", name = function() return _("Highlight of the day") end, desc = function() return _("One of your highlights, daily") end, sizes = { "L", "M", "W" }, tab = "reading", chrome = "fill" },
    { type = "streak", name = function() return _("Streak") end, desc = function() return _("Days in a row, and your best") end, sizes = { "S", "M" }, tab = "stats" },
    { type = "week", name = function() return _("This week") end, desc = function() return _("Minutes read each day") end, sizes = { "M", "S" }, tab = "stats" },
    { type = "today", name = function() return _("Today") end, desc = function() return _("Minutes read today") end, sizes = { "S" }, tab = "stats" },
    { type = "calendar", name = function() return _("Reading calendar") end, desc = function() return _("This month, one square a day") end, sizes = { "M", "L" }, tab = "stats" },
    { type = "shelf", name = function() return _("Up next in series") end, desc = function() return _("The next book in each series you read") end, sizes = { "L", "XL" }, tab = "library", props = { source = "up-next-in-series" } },
    { type = "shelf", name = function() return _("Discover") end, desc = function() return _("A shuffle of your library") end, sizes = { "XL", "L" }, tab = "library", props = { source = "random", shuffle = true } },
    { type = "shelf", name = function() return _("Recently added") end, desc = function() return _("The newest books in your library") end, sizes = { "XL", "L" }, tab = "library", props = { source = "recently-added" } },
    { type = "shelf", name = function() return _("Shelf from your library") end, desc = function() return _("One library, collection, SmartScope, author or series") end, sizes = { "XL", "L" }, tab = "library", pick = true, props = { source = "random" } },
    { type = "link", name = function() return _("Library") end, desc = function() return _("All your books") end, sizes = { "S" }, tab = "library", props = { link = "library" } },
    { type = "link", name = function() return _("Series") end, desc = function() return _("Every series") end, sizes = { "S" }, tab = "library", props = { link = "series" } },
    { type = "link", name = function() return _("Authors") end, desc = function() return _("Every author") end, sizes = { "S" }, tab = "library", props = { link = "authors" } },
    { type = "link", name = function() return _("Collections") end, desc = function() return _("Your collections") end, sizes = { "S" }, tab = "library", props = { link = "collections" } },
    { type = "link", name = function() return _("SmartScopes") end, desc = function() return _("Your saved SmartScopes") end, sizes = { "S" }, tab = "library", props = { link = "scopes" } },
    { type = "link", name = function() return _("On device") end, desc = function() return _("Books on this device, and space left") end, sizes = { "S" }, tab = "device", props = { link = "device" } },
    { type = "link", name = function() return _("Search") end, desc = function() return _("Search your library") end, sizes = { "S" }, tab = "library", props = { link = "search" } },
    { type = "clock", name = function() return _("Clock") end, desc = function() return _("Time and date, each minute") end, sizes = { "S", "M" }, tab = "device", chrome = "ink" },
    { type = "sync", name = function() return _("Sync status") end, desc = function() return _("Last sync, with Sync now") end, sizes = { "S" }, tab = "device" },
    { type = "buddy", name = function() return _("Reading buddy") end, desc = function() return _("A cat that keeps you company") end, sizes = { "L", "M", "S" }, tab = "decor", new = true },
    { type = "buddy", name = function() return _("Reading dog") end, desc = function() return _("A floppy-eared friend for every chapter") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "dog" } },
    { type = "buddy", name = function() return _("Reading rabbit") end, desc = function() return _("A quiet companion with a curious nose") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "rabbit" } },
    { type = "buddy", name = function() return _("Reading owl") end, desc = function() return _("A feathered friend for one more page") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "owl" } },
    { type = "buddy", name = function() return _("Reading penguin") end, desc = function() return _("A little bookworm in a feathered coat") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "penguin" } },
    { type = "buddy", name = function() return _("Reading robot") end, desc = function() return _("Recharges with a good book") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "robot" } },
    { type = "buddy", name = function() return _("Reading vampire") end, desc = function() return _("A tiny night owl with a cape and fangs") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "vampire" } },
    { type = "buddy", name = function() return _("Reading dragon") end, desc = function() return _("A little dragon guarding a hoard of stories") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "dragon" } },
    { type = "buddy", name = function() return _("Reading ghost") end, desc = function() return _("A friendly spirit between the pages") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "ghost" } },
    { type = "buddy", name = function() return _("Reading mimic") end, desc = function() return _("A book that reads you back") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "mimic" } },
    { type = "buddy", name = function() return _("Reading mummy") end, desc = function() return _("Three thousand years of catching up") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "mummy" } },
    { type = "buddy", name = function() return _("Reading witch") end, desc = function() return _("Never without her spellbook") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "witch" } },
    { type = "buddy", name = function() return _("Reading skeleton") end, desc = function() return _("Reads to the bone") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "skeleton" } },
    { type = "buddy", name = function() return _("Reading candle") end, desc = function() return _("Burns the midnight oil") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "candle" } },
    { type = "buddy", name = function() return _("Reading alien") end, desc = function() return _("Came a long way for a good book") end, sizes = { "L", "M", "S" }, tab = "decor", new = true, props = { animal = "alien" } },
    { type = "chapters", name = function() return _("Chapter line") end, desc = function() return _("Your book as a line, chapters as stops") end, sizes = { "L", "M", "W", "S" }, tab = "decor", new = true },
    { type = "badge", name = function() return _("Next badge") end, desc = function() return _("The badge you are closest to earning") end, sizes = { "M", "L", "S" }, tab = "decor", new = true },
    { type = "dust", name = function() return _("Gathering dust") end, desc = function() return _("Books you downloaded and never opened") end, sizes = { "M", "L", "S" }, tab = "decor", new = true },
    { type = "rings", name = function() return _("Tree rings") end, desc = function() return _("A ring for every month you read") end, sizes = { "L", "M" }, tab = "decor", new = true },
    { type = "odometer", name = function() return _("Pages turned") end, desc = function() return _("Every page, on a counter") end, sizes = { "M", "S" }, tab = "decor", new = true },
    { type = "glyph", name = function() return _("Glyph of the day") end, desc = function() return _("One letter from your fonts") end, sizes = { "S", "M", "L" }, tab = "decor", new = true },
    { type = "analog", name = function() return _("Analog clock") end, desc = function() return _("A clock face, each minute") end, sizes = { "S", "M" }, tab = "decor", new = true, chrome = "ink" },
    { type = "moon", name = function() return _("Moon phase") end, desc = function() return _("Tonight's moon") end, sizes = { "S", "M" }, tab = "decor", new = true, chrome = "ink" },
}

BoardEdit.TABS = {
    { id = "new", label = function() return _("New") end },
    { id = "reading", label = function() return _("Reading") end },
    { id = "stats", label = function() return _("Stats") end },
    { id = "library", label = function() return _("Library") end },
    { id = "device", label = function() return _("Device") end },
    { id = "decor", label = function() return _("Decor") end },
}

local function sameProps(a, b)
    a, b = a or {}, b or {}
    return a.source == b.source and a.link == b.link and (a.animal or "cat") == (b.animal or "cat")
end

-- The library entry an item came from, for its supported sizes.
function BoardEdit.entryFor(item)
    local picked = item.type == "shelf" and item.props
        and require("bookorbit_dashboard_sections").isCatalogSelector(item.props.source)
    for _i, entry in ipairs(BoardEdit.LIBRARY) do
        if picked and entry.pick then return entry end
        if entry.type == item.type and (entry.type ~= "shelf" and entry.type ~= "link" and entry.type ~= "buddy" or sameProps(entry.props, item.props)) then
            return entry
        end
    end
    return nil
end

function BoardEdit.sizeCode(item, cols)
    for _i, code in ipairs({ "S", "M", "L", "W", "XL" }) do
        local cw, rh = BoardLayout.sizeDims(code, cols)
        if cw == math.min(item.cw, cols) and rh == item.rh then return code end
    end
    return nil
end

local function copyItem(it)
    local props = nil
    if it.props then
        props = {}
        for k, v in pairs(it.props) do props[k] = v end
    end
    return { type = it.type, cw = it.cw, rh = it.rh, chrome = it.chrome, props = props }
end

-- ------------------------------------------------------------- state
function BoardEdit:boardEditing()
    return self.board_edit ~= nil
end

function BoardEdit:boardGeometry()
    local m = BoardMetrics.get()
    local _top, bottom = self:menuChromeHeight()
    return BoardLayout.geometry(px, self.inner_dimen.w, self.inner_dimen.h - bottom, m.LW)
end

-- The pages being edited, as they are currently drawn: the reader's own or
-- the starter layout, fitted to this screen. A saved page that no longer fits
-- (a larger interface size, a shelf grown to two rows) is edited as shown,
-- never as an overfull grid the editor could not change; the widgets it has
-- no room for are kept aside as hidden.
function BoardEdit:boardEditablePages(g)
    local pages = self:boardPages(g.cols)
    local out = {}
    for index = 1, BoardStore.PAGE_COUNT do
        local page = pages[index] or { base = {} }
        local items, hidden = {}, {}
        local packed = BoardLayout.fitPage(g, page.base, page.extras)
        for _i, it in ipairs(packed.placed) do table.insert(items, copyItem(it)) end
        for _i, it in ipairs(packed.dropped) do table.insert(hidden, copyItem(it)) end
        out[index] = { id = page.id, items = items, hidden = hidden }
    end
    return out
end

-- Hidden widgets are saved after the ones on screen, so a smaller interface
-- size shows them again.
function BoardEdit:boardSavePages(g, pages)
    local m = BoardMetrics.get()
    local saved = {}
    for index, page in ipairs(pages) do
        local items = {}
        for _i, it in ipairs(page.items or {}) do table.insert(items, it) end
        for _i, it in ipairs(page.hidden or {}) do table.insert(items, it) end
        saved[index] = { id = page.id, items = items }
    end
    self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withCustomPages(self.settings, g.cols, saved, m.w > m.h))
end

function BoardEdit:boardPageFits(g, items)
    if #items == 0 then return true end
    local packed = BoardLayout.pack(items, g.cols)
    return BoardLayout.rowHeight(g, packed.rows) >= g.min_row
end

function BoardEdit:boardEnterEdit(select_index)
    if not self:dashboardMode() then return end
    local g = self:boardGeometry()
    self.board_edit = {
        pages = self:boardEditablePages(g),
        selected = select_index,
        sheet = false,
        sheet_tab = "new",
        sheet_page = 1,
        cols = g.cols,
    }
    self:updateItems(nil, true)
end

function BoardEdit:boardExitEdit()
    local edit = self.board_edit
    if not edit then return end
    self.board_edit = nil
    if edit.changed then
        self:boardSavePages(self:boardGeometry(), edit.pages)
    end
    self:boardRefreshIfMissing()
end

-- Redraws the board, then fetches the dashboard again only when it now shows
-- a shelf or a list of names the cached body does not hold. Drawing first
-- keeps the screen current while offline; covers stay cached either way.
function BoardEdit:boardRefreshIfMissing()
    self:updateItems(nil, true)
    local body = self.current_context and self.current_context.dashboard
    local sources, names = self:boardSources()
    local missing = body == nil
    for source in pairs(sources) do
        if source ~= "in-progress" and not (body and type(body.boardShelves) == "table" and body.boardShelves[source]) then missing = true end
    end
    for key in pairs(names) do
        if not (body and type(body.boardNames) == "table" and body.boardNames[key]) then missing = true end
    end
    if missing then
        self:loadDashboardRoot(true, { invisible = true })
    end
end

local function full(text)
    require("bookorbit_toast").error(text)
end

-- ------------------------------------------------------------- actions
function BoardEdit:boardEditRun(action)
    local edit = self.board_edit
    if not edit then return end
    local g = self:boardGeometry()
    local page = self:boardPage()
    local items = edit.pages[page].items
    local kind = action.kind
    if kind == "edit-done" then
        return self:boardExitEdit()
    elseif kind == "edit-select" then
        edit.selected = edit.selected == action.index and nil or action.index
    elseif kind == "edit-move" then
        local i = edit.selected
        local j = i and i + action.delta
        if i and j and j >= 1 and j <= #items then
            items[i], items[j] = items[j], items[i]
            edit.selected = j
            edit.changed = true
        end
    elseif kind == "edit-size" then
        local it = items[edit.selected or 0]
        if it then
            local cw, rh = BoardLayout.sizeDims(action.code, g.cols)
            local old_cw, old_rh = it.cw, it.rh
            it.cw, it.rh = cw, rh
            if not self:boardPageFits(g, items) then
                it.cw, it.rh = old_cw, old_rh
                return full(_("There is not enough room on this page for that size."))
            end
            edit.changed = true
        end
    elseif kind == "edit-remove" then
        local i = action.index or edit.selected
        if i and items[i] then
            table.remove(items, i)
            edit.selected = nil
            edit.changed = true
        end
    elseif kind == "edit-page" then
        local i = edit.selected
        if i and items[i] then
            local target = page % BoardStore.PAGE_COUNT + 1
            local moved = items[i]
            local dest = edit.pages[target].items
            table.insert(dest, moved)
            if not self:boardPageFits(g, dest) then
                table.remove(dest)
                return full(T(_("%1 is full. Remove a widget there first."), BoardStore.pageNames(edit.pages)[target]))
            end
            table.remove(items, i)
            edit.selected = nil
            edit.changed = true
            full(T(_("Moved to %1."), BoardStore.pageNames(edit.pages)[target]))
        end
    elseif kind == "edit-add" then
        edit.sheet = true
        edit.sheet_page = 1
    elseif kind == "sheet-close" then
        edit.sheet = false
    elseif kind == "sheet-tab" then
        edit.sheet_tab = action.tab
        edit.sheet_page = 1
    elseif kind == "sheet-page" then
        edit.sheet_page = math.max(1, (edit.sheet_page or 1) + action.delta)
    elseif kind == "sheet-add" and action.entry.pick then
        edit.sheet = false
        self:updateItems(nil, true)
        return self:boardPickShelfSource()
    elseif kind == "sheet-add" then
        local entry = action.entry
        local cw, rh = BoardLayout.sizeDims(entry.sizes[1], g.cols)
        local item = { type = entry.type, cw = cw, rh = rh, chrome = entry.chrome or "line", props = entry.props and copyItem(entry).props or nil }
        table.insert(items, item)
        if not self:boardPageFits(g, items) then
            -- Try the smallest size it offers before giving up.
            local smallest = entry.sizes[#entry.sizes]
            item.cw, item.rh = BoardLayout.sizeDims(smallest, g.cols)
            for _i, code in ipairs(entry.sizes) do
                local tcw, trh = BoardLayout.sizeDims(code, g.cols)
                if tcw * trh < item.cw * item.rh then item.cw, item.rh = tcw, trh end
            end
            if not self:boardPageFits(g, items) then
                table.remove(items)
                return full(_("This page is full. Remove a widget first, or add it on another page."))
            end
        end
        edit.sheet = false
        edit.selected = #items
        edit.changed = true
    elseif kind == "edit-pages" then
        return self:boardShowPagesMenu()
    end
    self:updateItems(nil, true)
end

-- Which list to pick a shelf from. The list opens in pick mode: tapping an
-- entry adds it as a shelf instead of opening it.
function BoardEdit:boardPickShelfSource()
    require("bookorbit_dialog_ui").actions{
        title = _("Show a shelf of"),
        sub = _("Pick where its books come from"),
        rows = {
            { icon = "library", label = _("A library, collection or SmartScope"), opens = true, run = function()
                self:loadShelves({ dashboard_source_index = "board" })
            end },
            { icon = "user", label = _("An author"), opens = true, run = function()
                self:loadSection("authors", { dashboard_source_index = "board" })
            end },
            { icon = "layers-2", label = _("A series"), opens = true, run = function()
                self:loadSection("series", { dashboard_source_index = "board" })
            end },
        },
    }
end

-- The picked list becomes a full-width shelf on the page being edited.
function BoardEdit:boardAddPickedShelf(source)
    self:onReturn()
    while self.stack and #self.stack > 0 and not self:dashboardMode() do self:onReturn() end
    local edit = self.board_edit
    if not edit or not self:dashboardMode() then return end
    local g = self:boardGeometry()
    local items = edit.pages[self:boardPage()].items
    local params = {}
    for k, v in pairs(source.params or {}) do params[k] = v end
    table.insert(items, { type = "shelf", cw = g.cols, rh = 2, chrome = "line",
        props = { source = source.type, params = params, title = source.sourceName } })
    if not self:boardPageFits(g, items) then
        table.remove(items)
        self:updateItems(nil, true)
        return full(_("This page is full. Remove a widget first, or add it on another page."))
    end
    edit.selected = #items
    edit.changed = true
    -- The new shelf's books are fetched now, not when editing ends.
    self:boardRefreshIfMissing()
end

function BoardEdit:boardShowPagesMenu()
    local DialogUI = require("bookorbit_dialog_ui")
    DialogUI.actions{
        title = _("Pages"),
        rows = {
            { icon = "rotate-ccw", label = _("Reset this page"), sub = _("Back to how it started"), run = function()
                self:boardResetPage(self:boardPage())
            end },
            { icon = "rotate-ccw", label = _("Reset all pages"), sub = _("Every page back to how it started"), run = function()
                DialogUI.confirm{
                    title = _("Reset all pages?"),
                    text = _("Every page goes back to its starting layout."),
                    ok_label = _("Reset"),
                    on_ok = function() self:boardResetAll() end,
                }
            end },
        },
    }
end

function BoardEdit:boardResetPage(page)
    local edit = self.board_edit
    if not edit then return end
    local g = self:boardGeometry()
    local state = BoardStore.read(self.settings)
    local m = BoardMetrics.get()
    local starter = BoardStore.starterPages(g.cols, state.preset, self:boardHasLight(), m.w > m.h)[page]
    local packed = BoardLayout.fitPage(g, starter.base, starter.extras)
    local items = {}
    for _i, it in ipairs(packed.placed) do table.insert(items, copyItem(it)) end
    edit.pages[page].items = items
    edit.selected = nil
    edit.changed = true
    self:updateItems(nil, true)
end

function BoardEdit:boardResetAll()
    local state = BoardStore.read(self.settings)
    self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withPreset(self.settings, state.preset))
    self.board_edit = nil
    self:boardRefreshIfMissing()
end

-- Shelves a reader picked for the old four-slot dashboard (one library,
-- collection, SmartScope, author or series) carry over onto the board once it
-- has started, on the first page with room for them. The old setting is then
-- dropped, so this runs once. Returns true when it ran.
function BoardEdit:boardMigrateLegacyShelves()
    local DashboardSections = require("bookorbit_dashboard_sections")
    local stored = self.settings[DashboardSections.SETTING_KEY]
    if stored == nil or not BoardStore.read(self.settings).started then return false end
    local legacy = DashboardSections.normalize(stored)
    local g = self:boardGeometry()
    local shelves = {}
    for index = 1, DashboardSections.SLOT_COUNT do
        local entry = legacy[index]
        if entry and DashboardSections.isCatalogSelector(entry.type) and type(entry.params) == "table" then
            table.insert(shelves, { type = "shelf", cw = g.cols, rh = 2, chrome = "line",
                props = { source = entry.type, params = entry.params, title = entry.sourceName } })
        end
    end
    if #shelves > 0 then
        local pages = self:boardEditablePages(g)
        for _i, shelf in ipairs(shelves) do
            local placed = false
            for _j, page in ipairs({ 1, 3, 2 }) do
                local items = pages[page].items
                table.insert(items, shelf)
                if self:boardPageFits(g, items) then
                    placed = true
                    break
                end
                table.remove(items)
            end
            -- The reader chose this shelf; the starter's last widgets on the
            -- Library page give way to it.
            if not placed then
                local items = pages[3].items
                table.insert(items, 1, shelf)
                while #items > 1 and not self:boardPageFits(g, items) do table.remove(items) end
            end
        end
        self:boardSavePages(g, pages)
    end
    self:persistSetting(DashboardSections.SETTING_KEY, nil)
    return true
end

-- ------------------------------------------------------------- settings
function BoardEdit:boardSetTiles(tiles)
    self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withTiles(self.settings, tiles))
    if self:dashboardMode() then self:updateItems(nil, true) end
end

function BoardEdit:boardSetColour(colour)
    self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withColour(self.settings, colour))
    require("bookorbit_board_ui").clearSnapshots()
    if self:dashboardMode() then self:updateItems(nil, true) end
end

function BoardEdit.install(Catalog)
    for name, fn in pairs(BoardEdit) do
        if name ~= "install" and type(fn) == "function" and name:match("^board") then
            Catalog[name] = fn
        end
    end
end

return BoardEdit
