--[[--
The widget dashboard, installed over the catalog's dashboard view.

Draws the board for the current page: a header (greeting, date, device
status, search and menu), the packed grid of widget tiles, and a footer that
moves between the pages. Swipes and page-turn keys flip pages too.

Every tile is one InputContainer, so a change refreshes only that tile's
rectangle. Widgets record the regions a tap can land on while they paint, so
a tap goes to exactly what was drawn there: a cover, a stepper, a button. A
D-pad press is a tap at the focused tile's centre, which lands on the tile's
own action.
]]

local Device = require("device")
local Event = require("ui/event")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local VerticalSpan = require("ui/widget/verticalspan")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardColour = require("bookorbit_board_colour")
local BoardData = require("bookorbit_board_data")
local BoardEdit = require("bookorbit_board_edit")
local BoardLayout = require("bookorbit_board_layout")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardStore = require("bookorbit_board_store")
local BoardUI = require("bookorbit_board_ui")
local BoardWidgets = require("bookorbit_board_widgets")
local CatalogWidgets = require("bookorbit_catalog_widgets")

local Screen = Device.screen
local INK = BoardMetrics.INK
local px, lh1 = BoardMetrics.px, BoardMetrics.lh1
local text, runs, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.runs, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local CatalogBoard = {}

-- --------------------------------------------------------------- tiles
local BoardTile = InputContainer:extend{
    item = nil,
    menu = nil,
    hits = nil,
}

function BoardTile:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = function() return self.dimen end } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = function() return self.dimen end } },
    }
end

function BoardTile:actionAt(pos)
    if pos and self.hits then
        for index = #self.hits, 1, -1 do
            local area = self.hits[index]
            if area.dimen and pos:intersectWith(area.dimen) then return area.action end
        end
    end
    return self.item.action
end

function BoardTile:onTapSelect(_, ges)
    local action = self:actionAt(ges and ges.pos)
    if action then self.menu:boardRun(action, self) end
    return true
end

-- Holding a widget starts editing the board with that widget selected.
function BoardTile:onHoldSelect()
    if self.item.index and not self.menu:boardEditing() then
        self.menu:boardEnterEdit(self.item.index)
    end
    return true
end

-- A zero-height stand-in for KOReader's title bar while the board is shown:
-- the board draws its own header.
local TitleBarStub = VerticalSpan:extend{ width = 0 }
function TitleBarStub:getHeight() return 0 end
function TitleBarStub:setTitle() end
function TitleBarStub:setSubTitle() end
function TitleBarStub:setLeftIcon() end
function TitleBarStub:generateVerticalLayout() return {} end
function TitleBarStub:generateHorizontalLayout() return {} end

function CatalogBoard:boardTitleBar()
    return TitleBarStub:new{}
end

-- -------------------------------------------------------------- context
function CatalogBoard:boardHasLight()
    return Device:hasFrontlight()
end

function CatalogBoard:boardLandscape()
    local m = BoardMetrics.get()
    return m.w > m.h
end

function CatalogBoard:boardPages(cols)
    return BoardStore.pages(self.settings, cols, self:boardHasLight(), self:boardLandscape())
end

-- The names of the pages on screen, in order: a Stats or Library starter puts
-- a different page first.
function CatalogBoard:boardPageNames(cols)
    if self.board_edit then return BoardStore.pageNames(self.board_edit.pages) end
    return BoardStore.pageNames(self:boardPages(cols))
end

-- The page shown, kept on the dashboard context so going into a book and
-- back returns to the same page.
function CatalogBoard:boardPage()
    local context = self.current_context or {}
    local page = tonumber(context.board_page) or 1
    return math.max(1, math.min(BoardStore.PAGE_COUNT, page))
end

function CatalogBoard:boardMd5(book)
    local path = self:dashboardResumePath(book)
    if not path then return nil end
    self._board_md5 = self._board_md5 or {}
    local md5 = self._board_md5[path]
    if md5 == nil then
        local ok, util = pcall(require, "util")
        md5 = ok and util.partialMD5 and util.partialMD5(path) or false
        self._board_md5[path] = md5
    end
    return md5 or nil
end
CatalogBoard.boardBookMd5 = CatalogBoard.boardMd5

-- --------------------------------------------------------------- render
function CatalogBoard:recalculateDashboardDimen()
    self.perpage = 1
    self.page = 1
    self.page_num = 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_dimen = Geom:new{ x = 0, y = 0, w = self.inner_dimen.w, h = self.available_height }
end

local statusCluster = BoardUI.statusCluster

function CatalogBoard:boardHeader(d, w, mode, page_name)
    local box = px(44)
    local tap_pad = math.floor((box - px(24)) / 2)
    local function iconButton(name, action, nudge)
        local btn = hstack({ w = box, h = box }, { flex(0), icon(name, px(23), { sw = 2 }), flex(0) })
        return BoardUI.hit(btn, action), nudge
    end
    if mode == "edit" then
        local done_inner = hstack({ h = px(40) }, { space(px(20), 1), text(_("Done"), { s = 15, b = true, col = INK.white }), space(px(20), 1) })
        local done = BoardUI.hit(BoardUI.box({ w = done_inner:getSize().w, h = px(40), radius = px(20), bg = INK.black }, done_inner), { kind = "edit-done" })
        local tw = w - done:getSize().w - px(12)
        local edit_page = self.board_edit and self.board_edit.pages[self:boardPage()]
        local hidden = edit_page and edit_page.hidden and #edit_page.hidden or 0
        local hint = hidden > 0
            and T(_.ngettext("%1 widget does not fit at this interface size", "%1 widgets do not fit at this interface size", hidden), hidden)
            or _("Tap a widget to move, resize or remove it")
        return hstack({ w = w, h = px(64) }, {
            vstack({ w = tw }, {
                text(T(_("Edit %1"), page_name), { s = 22, b = true, w = tw }),
                text(hint, { s = 13, col = INK.g4, w = tw }),
            }),
            space(px(12), 1),
            done,
        })
    end
    local status = statusCluster(d)
    local search = iconButton("search", { kind = "search" })
    local menu = iconButton("menu", { kind = "menu" })
    local right_w = status:getSize().w + px(6) + 2 * box - tap_pad
    local tw = w - right_w
    local function fits(parts) return runs(parts, { s = 13 }):getSize().w <= tw end
    local parts
    if d.online or not d.stale then
        parts = { { t = d.date_long } }
    else
        -- Offline: the date gives way first, then when it was saved.
        local offline = { t = _("Offline"), b = true, col = INK.black }
        local saved = { t = d.updated and (", " .. T(_("saved %1"), d.updated)) or "" }
        parts = { { t = d.date_long .. " · " }, offline, saved }
        if not fits(parts) then parts = { offline, saved } end
        if not fits(parts) then parts = { offline } end
    end
    local sub = runs(parts, { s = 13, col = INK.g4, w = tw })
    -- A long greeting steps down to 18 before it is cut.
    local greet_s = BoardUI.fitSize(d.greeting, { s = 22, b = true }, tw, 18)
    return hstack({ w = w + tap_pad, h = px(64) }, {
        vstack({ w = tw }, { text(d.greeting, { s = greet_s, b = true, w = tw }), sub }),
        status,
        space(px(6), 1),
        search,
        menu,
    })
end

function CatalogBoard:boardFooter(w, page, mode)
    local fh = px(40)
    local names = self:boardPageNames(self._board_geometry and self._board_geometry.cols or BoardLayout.columnsFor(BoardMetrics.layoutW()))
    local function chev(name, enabled, delta)
        local btn = hstack({ w = px(44), h = fh }, { flex(0), icon(name, px(20), { sw = 2.5, col = enabled and "black" or "gb" }), flex(0) })
        return BoardUI.hit(btn, enabled and { kind = "page", delta = delta } or { kind = "noop" })
    end
    local dot_items = {}
    for index = 1, BoardStore.PAGE_COUNT do
        table.insert(dot_items, BoardUI.dot(px(7), index == page, { off = INK.g8 }))
    end
    local dots = hstack({ gap = px(6) }, dot_items)
    if mode == "edit" then
        local add_inner = hstack({ h = px(38), gap = px(8) }, { space(px(6), 1), icon("plus", px(17), { col = "white", sw = 2.75 }), text(_("Add widget"), { s = 14, b = true, col = INK.white }), space(px(10), 1) })
        local add = BoardUI.hit(BoardUI.box({ w = add_inner:getSize().w, h = px(38), radius = px(19), bg = INK.black }, add_inner), { kind = "edit-add" })
        local side = px(120)
        return hstack({ w = w, h = fh }, {
            hstack({ w = side, gap = px(8) }, { dots, text(names[page], { s = 13, b = true }), flex(0) }),
            flex(0), add, flex(0),
            BoardUI.hit(hstack({ w = side, gap = px(4) }, { flex(0), icon("layout-grid", px(16), { sw = 2.25 }), text(_("Pages"), { s = 13, b = true }) }), { kind = "edit-pages" }),
        })
    end
    return hstack({ w = w, h = fh }, {
        flex(0),
        chev("chevron-left", page > 1, -1), space(px(6), 1),
        dots, space(px(6), 1), space(px(4), 1), space(px(6), 1),
        text(names[page], { s = 13, b = true }), space(px(6), 1),
        chev("chevron-right", page < BoardStore.PAGE_COUNT, 1),
        flex(0),
    })
end

-- Default tap action for each widget type. Widgets that draw their own
-- buttons (Resume, steppers, covers) route those taps themselves.
function CatalogBoard:boardItemAction(item, d)
    local t = item.type
    local lead = d.continue_reading[1]
    local tap_resumes = self.settings.catalog_dashboard_tap_resumes ~= false
    if t == "hero" or t == "forecast" then
        if lead then return { kind = "book", book = lead, resume = tap_resumes, list = { label = _("Continue reading"), books = d.continue_reading } } end
        return { kind = "books", params = { sort = "title" }, title = _("All books") }
    elseif t == "also" or t == "goalpace" then
        return { kind = "books", params = { sort = "recently_read", readStatus = "reading" }, title = _("In progress") }
    elseif t == "highlight" and d.highlight then
        return { kind = "highlight", highlight = d.highlight }
    elseif t == "shelf" then
        local source = item.props and item.props.source
        if source == "want-to-read" and not (item.props and item.props.params) then return nil end
        return { kind = "shelf", source = source, props = item.props }
    elseif t == "link" then
        return { kind = "link", link = item.props and item.props.link }
    elseif t == "yearago" and d.year_ago and d.year_ago.book then
        return { kind = "detail", book_id = d.year_ago.book.id }
    elseif t == "word" and d.word then
        return { kind = "lookup", word = d.word.word }
    elseif t == "sync" then
        return { kind = d.online and "sync" or "wifi" }
    elseif t == "chapters" and lead then
        return { kind = "book", book = lead, resume = tap_resumes, list = { label = _("Continue reading"), books = d.continue_reading } }
    elseif t == "dust" then
        local dust = d.dust
        if dust and dust.book then return { kind = "detail", book_id = dust.book.id } end
    end
    return nil
end

function CatalogBoard:boardBuildTile(ctx, item, w, h, edit)
    local frame, hits = BoardUI.collectHits(function() return BoardWidgets.tile(ctx, item, w, h) end)
    return BoardTile:new{
        dimen = Geom:new{ w = w, h = h },
        item = item,
        menu = self,
        -- In edit mode a tap selects the widget, whatever is drawn under it.
        hits = not edit and hits or nil,
        CatalogWidgets.focusable(frame),
    }
end

-- A tappable region that is not a widget tile: the header, the footer, the
-- edit bar, a sheet.
function CatalogBoard:boardRegion(build, action)
    local widget, hits = BoardUI.collectHits(build)
    local size = widget:getSize()
    return BoardTile:new{
        dimen = Geom:new{ w = size.w, h = size.h },
        item = { action = action },
        menu = self,
        hits = hits,
        CatalogWidgets.focusable(widget),
    }
end

-- ---------------------------------------------------------- edit overlays
local SIZE_ORDER = { "S", "M", "L", "W", "XL" }
local SIZE_LABELS = { S = "S", M = "M", L = "L", W = function() return _("Wide") end, XL = "XL" }

local function sizeLabel(code)
    local l = SIZE_LABELS[code]
    return type(l) == "function" and l() or l
end

function CatalogBoard:boardEditBar(item, index, g)
    local bar_h = px(52)
    local function button(name, label, action)
        local inner = vstack({ align = "center" }, {
            icon(name, px(19), { col = "white", sw = 2.25 }),
            space(nil, px(2)),
            text(label, { s = 11, b = true, col = INK.white }),
        })
        return BoardUI.hit(hstack({ h = bar_h }, { space(px(10), 1), inner, space(px(10), 1) }), action)
    end
    local function divider()
        return BoardUI.rect(math.max(1, px(1)), px(30), INK.g5)
    end
    local entry = BoardEdit.entryFor(item)
    local current = BoardEdit.sizeCode(item, g.cols)
    local segs = { text(_("Size"), { s = 11, b = true, col = INK.gb }) }
    local offered = {}
    for _i, code in ipairs(entry and entry.sizes or { current }) do offered[code] = true end
    local seen_dims = {}
    for _i, code in ipairs(SIZE_ORDER) do
        local cw, rh = BoardLayout.sizeDims(code, g.cols)
        local dims = cw .. "x" .. rh
        if offered[code] and not seen_dims[dims] then
            seen_dims[dims] = true
            local on = cw == math.min(item.cw, g.cols) and rh == item.rh
            local label = text(sizeLabel(code), { s = 13, b = true, col = on and INK.black or INK.white })
            local w = math.max(px(30), label:getSize().w + 2 * px(6))
            local seg = BoardUI.box({ w = w, h = px(30), radius = px(6), bg = on and INK.white or nil, border = on and 0 or math.max(1, px(1)), border_col = INK.g8 },
                hstack({ w = w - (on and 0 or 2 * math.max(1, px(1))), h = px(30) - (on and 0 or 2 * math.max(1, px(1))) }, { flex(0), label, flex(0) }))
            table.insert(segs, BoardUI.hit(seg, { kind = "edit-size", code = code }))
        end
    end
    local inner = hstack({ h = bar_h, gap = px(2) }, {
        space(px(6) - px(2), 1),
        button("chevron-left", _("Earlier"), { kind = "edit-move", delta = -1 }),
        button("chevron-right", _("Later"), { kind = "edit-move", delta = 1 }),
        divider(),
        hstack({ h = bar_h, gap = px(5) }, { space(px(8) - px(5), 1), unpack(segs) }),
        space(px(8), 1),
        divider(),
        button("layout-grid", _("Page"), { kind = "edit-page" }),
        button("x", _("Remove"), { kind = "edit-remove", index = index }),
        space(px(6) - px(2), 1),
    })
    local w = inner:getSize().w
    local ring = px(2)
    return BoardUI.overlay(w + 2 * ring, bar_h + 2 * ring, {
        { widget = BoardUI.rect(w + 2 * ring, bar_h + 2 * ring, INK.white, px(12) + ring) },
        { widget = BoardUI.box({ w = w, h = bar_h, radius = px(12), bg = INK.black }, inner), x = ring, y = ring },
    })
end

-- ------------------------------------------------------------ the sheet
function CatalogBoard:boardPreview(ctx, entry, box_w, box_h, g)
    -- Previews are drawn at the narrowest real column (132dp, a 6" panel),
    -- so a preview never shows a widget smaller than any board does.
    local unit = px(132)
    local cw, rh = BoardLayout.sizeDims(entry.sizes[1], 4)
    local pw = cw == 1 and unit or cw * unit + (cw - 1) * px(10)
    local ph = rh * unit + (rh - 1) * px(10)
    local scale = math.min(1, (box_h - px(16)) / ph, (box_w - px(20)) / pw)
    local sw, sh = math.floor(pw * scale + 0.5), math.floor(ph * scale + 0.5)
    local item = { type = entry.type, cw = cw, rh = rh, chrome = entry.chrome or "line", props = entry.props }
    local key = "preview:" .. entry.type .. ":" .. tostring(entry.props and (entry.props.source or entry.props.link or entry.props.animal) or "") .. ":" .. pw .. "x" .. ph .. ":" .. sw
    local shot = BoardUI.snapshot(key, pw, ph, sw, sh, function()
        return BoardWidgets.tile({ d = ctx.d, tiles = "outline", colour = ctx.colour, menu = self }, item, pw, ph)
    end)
    return BoardUI.box({ w = box_w, h = box_h, radius = px(12), bg = INK.ge }, hstack({ w = box_w, h = box_h }, { flex(0), shot, flex(0) }))
end

function CatalogBoard:boardSheet(ctx, g, screen_w, screen_h)
    local edit = self.board_edit
    local sheet_h = math.floor(screen_h * 0.7 + 0.5)
    local mx = g.mx
    local w = screen_w - 2 * mx
    local pad = px(18)
    local entries, new_count = {}, 0
    for _i, entry in ipairs(BoardEdit.LIBRARY) do
        if entry.new then new_count = new_count + 1 end
        if (edit.sheet_tab == "new" and entry.new) or entry.tab == edit.sheet_tab then table.insert(entries, entry) end
    end
    local tabs = {}
    for _i, tab in ipairs(BoardEdit.TABS) do
        local on = tab.id == edit.sheet_tab
        local label = text(tab.label(), { s = 14, b = on, col = on and INK.black or INK.g4 })
        table.insert(tabs, BoardUI.hit(vstack({ w = label:getSize().w, h = px(40) }, {
            flex(0), label, flex(0), on and BoardUI.rect(label:getSize().w, px(3), INK.black) or space(nil, px(3)),
        }), { kind = "sheet-tab", tab = tab.id }))
    end
    local tab_row = vstack({ w = w }, {
        hstack({ w = w, h = px(40), gap = px(BoardMetrics.layoutW() < 560 and 16 or 22), valign = "bottom" }, tabs),
        BoardUI.rect(w, math.max(1, px(1)), INK.gb),
    })
    local cols_n = BoardMetrics.layoutW() >= 700 and 3 or 2
    local gap = px(14)
    local card_w = math.floor((w - (cols_n - 1) * gap) / cols_n)
    local preview_h
    local stacked = false
    local function caption(entry)
        local chips = {}
        for _i, code in ipairs(entry.sizes) do
            local label = text(sizeLabel(code), { s = 11, b = true, col = INK.g3 })
            table.insert(chips, BoardUI.box({ w = label:getSize().w + 2 * px(5), h = label:getSize().h, radius = px(4), border = math.max(1, px(1)), border_col = INK.g8 },
                hstack({ w = label:getSize().w + 2 * px(5) - 2 * math.max(1, px(1)) }, { flex(0), label, flex(0) })))
        end
        local chip_row = hstack({ gap = px(4) }, chips)
        local name_w = card_w - chip_row:getSize().w - px(6)
        local name_s = BoardUI.fitSize(entry.name(), { s = 14, b = true }, name_w, 12)
        -- A name that does not fit beside its sizes even at 12 takes the
        -- line, with the sizes under it, and then so does every name so the
        -- cards line up on every tab.
        if text(entry.name(), { s = name_s, b = true }):getSize().w > name_w then stacked = true end
        local name_row
        if not stacked then
            name_row = BoardUI.spread(card_w, text(entry.name(), { s = name_s, b = true, w = name_w }), chip_row)
        else
            local s2 = BoardUI.fitSize(entry.name(), { s = 14, b = true }, card_w, 11)
            name_row = vstack({ w = card_w }, { text(entry.name(), { s = s2, b = true, w = card_w }), space(nil, px(4)), chip_row })
        end
        return vstack({ w = card_w }, {
            space(nil, px(6)),
            name_row,
            space(nil, px(6)),
            text(entry.desc(), { s = 12, col = INK.g4, lines = 2, w = card_w }),
        })
    end
    local function card(entry)
        return BoardUI.hit(vstack({ w = card_w }, {
            self:boardPreview(ctx, entry, card_w, preview_h, g),
            caption(entry),
        }), { kind = "sheet-add", entry = entry })
    end
    local head_h = pad + lh1(20) + lh1(13) + px(10) + px(40) + math.max(1, px(1)) + px(16)
    local pager_h = px(52)
    -- Rows are as tall as their tallest caption (a description can take two
    -- lines). Every widget's caption is measured, not just this tab's, so
    -- each tab keeps the same rows and cards per page.
    local text_h = 0
    local measured = BoardEdit.LIBRARY
    for _i, entry in ipairs(measured) do
        local sample = caption(entry)
        if sample.free then sample:free() end
    end
    for _i, entry in ipairs(measured) do
        local sample = caption(entry)
        text_h = math.max(text_h, sample:getSize().h)
        if sample.free then sample:free() end
    end
    local vgap = px(16)
    -- As many rows as fit with previews at least 80dp tall, the previews then
    -- grown to fill the sheet (up to a little taller than a card is wide), so
    -- a larger interface size leaves no band of empty sheet under the last
    -- row.
    local grid_h = sheet_h - head_h - pager_h
    local rows_fit = math.max(1, math.floor((grid_h + vgap) / (px(80) + text_h + vgap)))
    local preview_max = math.max(px(150), math.floor(card_w * 1.2))
    preview_h = math.max(px(64), math.min(preview_max, math.floor((grid_h + vgap) / rows_fit - vgap - text_h)))
    local per_page = rows_fit * cols_n
    local pages = math.max(1, math.ceil(#entries / per_page))
    edit.sheet_page = math.min(edit.sheet_page or 1, pages)
    local first = (edit.sheet_page - 1) * per_page + 1
    local grid_rows = {}
    for r = 0, rows_fit - 1 do
        local cards = {}
        for c = 0, cols_n - 1 do
            local entry = entries[first + r * cols_n + c]
            if entry then table.insert(cards, card(entry)) end
        end
        if #cards > 0 then
            if #grid_rows > 0 then table.insert(grid_rows, space(nil, vgap)) end
            table.insert(grid_rows, hstack({ gap = gap, valign = "top" }, cards))
        end
    end
    local function chev(name, enabled, delta)
        local b = hstack({ w = px(44), h = pager_h }, { flex(0), icon(name, px(22), { sw = 2.5, col = enabled and "black" or "gb" }), flex(0) })
        return BoardUI.hit(b, enabled and { kind = "sheet-page", delta = delta } or { kind = "noop" })
    end
    local pager = vstack({ w = w }, {
        BoardUI.rect(w, math.max(1, px(0.75)), INK.gc),
        hstack({ w = w, h = pager_h - math.max(1, px(0.75)), gap = px(18) }, {
            flex(0), chev("chevron-left", edit.sheet_page > 1, -1),
            text(T(_("%1 of %2"), edit.sheet_page, pages), { s = 13, b = true }),
            chev("chevron-right", edit.sheet_page < pages, 1), flex(0),
        }),
    })
    local close = BoardUI.hit(BoardUI.circle(px(40), { border = math.max(1, px(1.5)), bg = INK.white }, icon("x", px(20), { sw = 2.5 })), { kind = "sheet-close" })
    local title = vstack({}, {
        text(_("Add a widget"), { s = 20, b = true }),
        text(T(_("%1 widgets · %2 new"), #BoardEdit.LIBRARY, new_count), { s = 13, col = INK.g4 }),
    })
    local body = vstack({ w = screen_w, h = sheet_h, pad = { pad, mx, 0, mx } }, {
        BoardUI.spread(w, title, close),
        space(nil, px(10)),
        tab_row,
        space(nil, px(16)),
        vstack({ w = w }, grid_rows),
        flex(0),
        pager,
    })
    local line = math.max(1, px(2))
    local r = px(18)
    return BoardUI.overlay(screen_w, sheet_h + line, {
        { widget = BoardUI.rect(screen_w, sheet_h + line + r, INK.black, r) },
        { widget = BoardUI.rect(screen_w, sheet_h + r, INK.white, r), y = line },
        { widget = body, y = line },
    })
end

-- ----------------------------------------------------------- first run
function CatalogBoard:boardShowStarter(state, context)
    return not state.started and context.dashboard ~= nil and not self.board_edit and not self.board_snapshotting
end

local PRESET_INFO = {
    { id = "reader", name = function() return _("Reader") end, desc = function() return _("Your book first, then your pile, highlight and shelves") end },
    { id = "stats", name = function() return _("Stats") end, desc = function() return _("Year in reading, records and forecast up front") end },
    { id = "library", name = function() return _("Library") end, desc = function() return _("Pick back up, Up next and Want to read first") end },
}

function CatalogBoard:boardBuildStarter(ctx, g, screen_w, screen_h)
    local choice = self.board_starter_choice or "reader"
    local mx = g.mx
    local w = screen_w - 2 * mx
    local top = px(24)
    local head = vstack({ w = w }, {
        text(_("Set up your dashboard"), { s = 24, b = true, w = w }),
        space(nil, px(6)),
        text(_("Pick a starting layout. Each comes with four pages, Home, Insights, Library and Decor, that you can change any time: hold a widget to edit it."),
            { s = 14, col = INK.g3, lines = 3, w = w }),
    })
    local gap = px(BoardMetrics.layoutW() < 560 and 10 or 16)
    local card_w = math.floor((w - 2 * gap) / 3)
    local btn_h = px(48)
    -- The descriptions take the lines the longest needs on these cards (a
    -- phone at a large interface size needs four).
    local desc_lines = 3
    for _i, info in ipairs(PRESET_INFO) do
        local tb = require("ui/widget/textboxwidget"):new{ text = info.desc(), face = BoardMetrics.face(12), width = card_w - 2 * px(8) }
        desc_lines = math.max(desc_lines, math.min(5, math.floor(tb:getSize().h / BoardMetrics.lh(12) + 0.5)))
        tb:free()
    end
    local text_h = px(10) + lh1(16) + px(2) + desc_lines * BoardMetrics.lh(12) + px(8)
    local avail_prev = screen_h - top - head:getSize().h - px(24) - text_h - px(24) - btn_h - px(24)
    local scale = math.min((card_w - px(16)) / screen_w, avail_prev / screen_h)
    local pw, ph = math.floor(screen_w * scale + 0.5), math.floor(screen_h * scale + 0.5)
    local function snapshotFor(preset, page, sw, sh)
        return BoardUI.snapshot("starter:" .. preset .. ":" .. page .. ":" .. sw .. "x" .. sh, screen_w, screen_h, sw, sh, function()
            self.board_snapshotting = true
            local board = self:boardBuildScreen(ctx, g, page, screen_w, screen_h, { preset = preset, snapshot = true })
            self.board_snapshotting = false
            return board
        end)
    end
    local cards = {}
    local selected_name
    for _i, info in ipairs(PRESET_INFO) do
        local sel = info.id == choice
        if sel then selected_name = info.name() end
        local prev = BoardUI.overlay(pw, ph, {
            { widget = snapshotFor(info.id, 1, pw, ph) },
            { widget = BoardUI.box({ w = pw, h = ph, radius = px(6), border = math.max(1, px(1)), border_col = INK.gb }) },
        })
        local radio = BoardUI.circle(px(20), { border = math.max(1, px(1.5)), bg = INK.white },
            sel and BoardUI.circle(px(10), { bg = INK.black }, space(1, 1)) or space(1, 1))
        local iw = card_w - 2 * px(8)
        local inner = vstack({ w = card_w, pad = px(8), align = "center" }, {
            prev,
            space(nil, px(10)),
            hstack({ w = iw, gap = px(8) }, { radio, text(info.name(), { s = 16, b = true, w = iw - px(20) - px(8) }) }),
            space(nil, px(2)),
            text(info.desc(), { s = 12, col = INK.g4, lines = desc_lines, w = iw }),
            space(nil, px(8)),
        })
        local size = inner:getSize()
        local card_box = BoardUI.overlay(card_w, size.h, {
            { widget = BoardUI.rect(card_w, size.h, sel and INK.white or INK.ge, px(12)) },
            { widget = inner },
            { widget = BoardUI.box({ w = card_w, h = size.h, radius = px(12), border = sel and px(2.5) or math.max(1, px(1)), border_col = sel and INK.black or INK.gb }) },
        })
        table.insert(cards, self:boardRegion(function() return card_box end,
            { kind = "starter-pick", preset = info.id }))
    end
    local cards_row = hstack({ gap = gap, valign = "top" }, cards)
    local strip_label_h = lh1(13) + px(8)
    local strip_cap_h = px(6) + lh1(12)
    local room = screen_h - 2 * top - head:getSize().h - px(24) - cards_row:getSize().h - px(28) - strip_label_h - strip_cap_h - px(24) - btn_h
    local strip = false
    if room >= px(110) then
        local sg = px(14)
        local page_count = BoardStore.PAGE_COUNT
        local s2 = math.min((w - (page_count - 1) * sg) / page_count / screen_w, room / screen_h)
        local pw2, ph2 = math.floor(screen_w * s2 + 0.5), math.floor(screen_h * s2 + 0.5)
        local thumbs = {}
        for page, name in ipairs(BoardStore.pageNames(BoardStore.starterPages(g.cols, choice, self:boardHasLight(), self:boardLandscape()))) do
            table.insert(thumbs, vstack({ align = "center" }, {
                BoardUI.overlay(pw2, ph2, {
                    { widget = snapshotFor(choice, page, pw2, ph2) },
                    { widget = BoardUI.box({ w = pw2, h = ph2, radius = px(4), border = math.max(1, px(1)), border_col = INK.gb }) },
                }),
                space(nil, px(6)),
                text(page .. "  " .. name, { s = 12, b = true, col = INK.g3 }),
            }))
        end
        strip = vstack({ w = w, align = "center" }, {
            text(T(_("%1 comes with four pages"), selected_name), { s = 13, b = true }),
            space(nil, px(8)),
            hstack({ gap = sg }, thumbs),
        })
    end
    local btn_label = text(T(_("Start with %1"), selected_name), { s = 16, b = true, col = INK.white })
    local btn_w = btn_label:getSize().w + 2 * px(28)
    local button = self:boardRegion(function()
        return BoardUI.box({ w = btn_w, h = btn_h, radius = math.floor(btn_h / 2), bg = INK.black },
            hstack({ w = btn_w, h = btn_h }, { flex(0), btn_label, flex(0) }))
    end, { kind = "starter-start", preset = choice })
    local screen = vstack({ w = screen_w, h = screen_h, pad = { top, mx, top, mx } }, {
        head,
        space(nil, px(24)),
        cards_row,
        flex(px(16)),
        strip,
        strip and flex(px(16)) or false,
        hstack({ w = w }, { flex(0), button, flex(0) }),
    })
    return screen, { cards, { button } }
end

-- ------------------------------------------------------------ the board
-- Builds one board screen. opts.preset draws a starter layout instead of the
-- reader's pages; opts.snapshot builds it for a thumbnail and records
-- nothing on the catalog.
function CatalogBoard:boardBuildScreen(ctx, g, page, screen_w, screen_h, opts)
    opts = opts or {}
    local d = ctx.d
    local edit = not opts.snapshot and self.board_edit or nil
    local packed
    if edit then
        packed = BoardLayout.pack(edit.pages[page].items, g.cols)
        packed.row_h = math.min(g.max_row, BoardLayout.rowHeight(g, packed.rows))
        packed.grid_h = packed.rows * packed.row_h + math.max(0, packed.rows - 1) * g.gap
    else
        local pages
        if opts.preset then
            pages = BoardStore.starterPages(g.cols, opts.preset, self:boardHasLight(), self:boardLandscape())
        else
            pages = self:boardPages(g.cols)
        end
        packed = BoardLayout.fitPage(g, pages[page].base, pages[page].extras)
    end
    local tiles = {}
    local layers = {}
    local rows = {}
    local selected
    for index, item in ipairs(packed.placed) do
        local tw = BoardLayout.spanWidth(g, item.x, item.cw)
        local th = item.rh * packed.row_h + (item.rh - 1) * g.gap
        local x, y = BoardLayout.cellX(g, item.x), item.y * (packed.row_h + g.gap)
        local placed = {}
        for k, v in pairs(item) do placed[k] = v end
        placed.index = index
        placed.action = edit and { kind = "edit-select", index = index } or self:boardItemAction(item, d)
        local tile = self:boardBuildTile(ctx, placed, tw, th, edit ~= nil)
        if edit and edit.selected == index then
            -- The selection ring: white, then black, outside the tile.
            local r = px(12)
            table.insert(layers, { widget = BoardUI.rect(tw + 2 * px(6), th + 2 * px(6), INK.black, r + px(6)), x = x - px(6), y = y - px(6) })
            table.insert(layers, { widget = BoardUI.rect(tw + 2 * px(3), th + 2 * px(3), INK.white, r + px(3)), x = x - px(3), y = y - px(3) })
            selected = { item = placed, index = index, x = x, y = y, w = tw, h = th }
        end
        table.insert(tiles, { tile = tile, item = placed, x = x, y = y, w = tw, h = th })
        table.insert(layers, { widget = tile, x = x, y = y })
        rows[item.y + 1] = rows[item.y + 1] or {}
        table.insert(rows[item.y + 1], tile)
    end
    if edit then
        local badge = px(26)
        for _i, entry in ipairs(tiles) do
            local b = self:boardRegion(function()
                return BoardUI.circle(badge, { border = math.max(1, px(1.5)), bg = INK.white }, icon("x", px(15), { sw = 3 }))
            end, { kind = "edit-remove", index = entry.item.index })
            table.insert(layers, { widget = b, x = entry.x - px(7), y = entry.y - px(7) })
        end
        -- The Add widget sheet covers the bottom of the board; the bar for the
        -- selected widget comes back when it closes.
        if selected and not edit.sheet then
            local bar = self:boardRegion(function() return self:boardEditBar(selected.item, selected.index, g) end, { kind = "noop" })
            local bw, bh = bar:getSize().w, bar:getSize().h
            local left = math.max(0, math.min(g.w - bw, selected.x + math.floor((selected.w - bw) / 2)))
            local below = selected.y + selected.h + px(12)
            local top = BoardLayout.editBarTop(selected.y, selected.h, bh, px(12), g.avail)
            packed.grid_h = math.max(packed.grid_h, top + bh)
            table.insert(layers, { widget = bar, x = left, y = top })
        end
    end
    local grid = BoardUI.overlay(g.w, packed.grid_h, layers)
    local mode = edit and "edit" or "normal"
    local header = self:boardRegion(function() return self:boardHeader(d, g.w, mode, self:boardPageNames(g.cols)[page]) end)
    local footer = self:boardRegion(function() return self:boardFooter(g.w, page, mode) end)
    local board = vstack({ w = screen_w, h = screen_h, pad = { g.top, g.mx, g.bottom, g.mx } }, {
        header,
        space(nil, g.header_gap),
        grid,
        flex(g.footer_gap),
        footer,
    })
    if not opts.snapshot then
        self._board_tiles = tiles
        self._board_header = header
        self._board_origin = { x = g.mx, y = g.top + g.header_h + g.header_gap }
    end
    return board, rows, packed
end

local PROFILE = os.getenv("BO_BOARD_PROFILE") ~= nil

function CatalogBoard:updateDashboardItems(select_number, no_recalculate_dimen)
    -- However the board started (the starter screen, or a layout picked in
    -- the menu while the catalog was closed), the old picked shelves join it
    -- before its first draw. The refresh that follows fetches their books.
    self:boardMigrateLegacyShelves()
    local t0 = PROFILE and os.clock()
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    self:ensureOnDeviceCurrent()
    BoardMetrics.refresh()
    local context = self.current_context or {}
    local m = BoardMetrics.get()
    local screen_w = self.inner_dimen.w
    local screen_h = self.available_height
    local g = BoardLayout.geometry(px, screen_w, screen_h, m.LW)
    local page = self:boardPage()
    local d = BoardData.build(self, context, os.time())
    local state = BoardStore.read(self.settings)
    local ctx = { d = d, tiles = state.tiles, colour = state.colour, menu = self, tap_resumes = self.settings.catalog_dashboard_tap_resumes ~= false }
    self._board_ctx = ctx
    self._board_geometry = g
    local t_data = PROFILE and os.clock()

    local screen, rows, packed
    if self:boardShowStarter(state, context) then
        screen, rows = self:boardBuildStarter(ctx, g, screen_w, screen_h)
        self._board_tiles, self._board_header = {}, nil
    else
        BoardUI.clearSnapshots("starter:")
        screen, rows, packed = self:boardBuildScreen(ctx, g, page, screen_w, screen_h)
        if self.board_edit and self.board_edit.sheet then
            local sheet = self:boardRegion(function() return self:boardSheet(ctx, g, screen_w, screen_h) end, { kind = "noop" })
            local sh = sheet:getSize().h
            local backdrop = self:boardRegion(function()
                return space(screen_w, screen_h - sh)
            end, { kind = "sheet-close" })
            screen = BoardUI.overlay(screen_w, screen_h, {
                { widget = screen },
                { widget = backdrop },
                { widget = sheet, x = 0, y = screen_h - sh },
            })
        else
            BoardUI.clearSnapshots("preview:")
        end
    end
    table.insert(self.item_group, screen)
    -- D-pad order: the grid row by row.
    for row_index = 1, #rows do
        if rows[row_index] and #rows[row_index] > 0 then table.insert(self.layout, rows[row_index]) end
    end
    if PROFILE and packed then
        logger.info(string.format("BOARDPROF page=%d data=%.1fms build=%.1fms tiles=%d", page, (t_data - t0) * 1000, (os.clock() - t_data) * 1000, #packed.placed))
        local timings = {}
        for _i, entry in ipairs(self._board_tiles) do
            local t1 = os.clock()
            BoardWidgets.tile(ctx, entry.item, entry.w, entry.h)
            table.insert(timings, string.format("%s=%.1f", entry.item.type, (os.clock() - t1) * 1000))
        end
        logger.info("BOARDPROF tiles " .. table.concat(timings, " "))
    end
    if packed then self:boardDump(d, page) end
    self:boardScheduleClock()
    self:finishCustomUpdate(old_dimen, select_number)
    self:boardRefreshPets()
end

-- A colour screen shows colour only through a dithered refresh (on Kaleido,
-- its colour waveform), and the board's own "ui" refresh is not one. With the
-- Colour setting on, the whole board gets one; with it off, only the pets,
-- which are colour pictures, get their own.
function CatalogBoard:boardRefreshPets()
    if not Screen:isColorEnabled() then return end
    if BoardColour.on(self._board_ctx) then
        UIManager:setDirty(nil, function()
            if self.dimen and self.dimen.x then return "partial", self.dimen, true end
        end)
        return
    end
    for _i, entry in ipairs(self._board_tiles or {}) do
        if entry.item.type == "buddy" then
            local tile = entry.tile
            UIManager:setDirty(nil, function()
                if tile.dimen and tile.dimen.x then return "partial", tile.dimen, true end
            end)
        end
    end
end

-- Repaints one tile in place: rebuilds its content and refreshes only its
-- rectangle, so a stepper or a hero page does not flash the whole board. A
-- coloured board's tiles keep their colours through the dithered refresh.
function CatalogBoard:boardRefreshTile(entry, mode, dither)
    if not entry or not self._board_ctx then return end
    -- The digital clock is black and white unless tiles are tinted, so its
    -- minute stays on the fast refresh.
    local plain_clock = entry.item.type == "clock" and not BoardColour.tinted(self._board_ctx)
    if BoardColour.on(self._board_ctx) and not plain_clock and (mode == nil or mode == "ui" or mode == "fast") then
        mode, dither = "partial", true
    end
    self._board_ctx.d = BoardData.build(self, self.current_context or {}, os.time())
    local fresh = self:boardBuildTile(self._board_ctx, entry.item, entry.w, entry.h)
    entry.tile[1] = fresh[1]
    entry.tile.hits = fresh.hits
    local dimen = entry.tile.dimen
    if dimen and dimen.x then
        UIManager:setDirty(self.show_parent, function() return mode or "ui", dimen, dither end)
    else
        self:updateItems(nil, true)
    end
end

-- ------------------------------------------------------------- clock
-- Once a minute the header's clock and any Clock or Analog clock widget are
-- redrawn in place, and on the hour the Reading buddy and Moon phase.
-- Nothing else on the board changes on a timer.
function CatalogBoard:boardScheduleClock()
    if self._board_clock_task then UIManager:unschedule(self._board_clock_task) end
    self._board_clock_task = function()
        self._board_clock_task = nil
        if self.catalog_closed or not self:dashboardMode() then return end
        if self:boardIsTopmost() then self:boardRefreshClock() end
        self:boardScheduleClock()
    end
    UIManager:scheduleIn(60 - os.time() % 60 + 1, self._board_clock_task)
end

function CatalogBoard:boardRefreshClock()
    if self.board_edit then return end
    local ctx = self._board_ctx
    local header_tile = self._board_header
    if not ctx or not header_tile or not header_tile.dimen or not header_tile.dimen.x then return end
    ctx.d = BoardData.build(self, self.current_context or {}, os.time())
    local g = self._board_geometry
    local header, hits = BoardUI.collectHits(function() return self:boardHeader(ctx.d, g.w, "normal", self:boardPageNames(g.cols)[self:boardPage()]) end)
    header_tile[1] = header
    header_tile.hits = hits
    local dimen = header_tile.dimen
    UIManager:setDirty(self.show_parent, function() return "fast", dimen end)
    local hour = os.date("%H")
    local new_hour = self._board_clock_hour ~= nil and self._board_clock_hour ~= hour
    self._board_clock_hour = hour
    for _i, entry in ipairs(self._board_tiles or {}) do
        local t = entry.item.type
        -- The buddy yawns at night and the moon moves on: both change at most
        -- by the hour, so they are redrawn only when one turns.
        if new_hour and t == "buddy" then
            -- "fast" is black and white only: a shaded pet needs its greys, or
            -- its colours through the dithered colour refresh.
            local colour = Screen:isColorEnabled()
            self:boardRefreshTile(entry, colour and "partial" or "ui", colour or nil)
        elseif t == "clock" or t == "analog" or (new_hour and t == "moon") then
            self:boardRefreshTile(entry, "fast")
        end
    end
end

function CatalogBoard:boardIsTopmost()
    local top = UIManager.getTopmostVisibleWidget and UIManager:getTopmostVisibleWidget()
    return top == nil or top == self or top == self.show_parent
end

-- ------------------------------------------------------------- actions
function CatalogBoard:boardRun(action, tile)
    local kind = action.kind
    if kind == "noop" then return end
    if kind:match("^edit%-") or kind:match("^sheet%-") then
        return self:boardEditRun(action)
    elseif kind == "starter-pick" then
        self.board_starter_choice = action.preset
        return self:updateItems(nil, true)
    elseif kind == "starter-start" then
        self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withPreset(self.settings, action.preset))
        BoardUI.clearSnapshots("starter:")
        if self.current_context then self.current_context.board_page = 1 end
        return self:boardRefreshIfMissing()
    elseif kind == "book-actions" then
        return self:showBookActionSheetForEntry({ kind = "dashboard-book", book_id = action.book.id, book = action.book })
    end
    if kind == "page" then
        return self:boardFlip(action.delta)
    elseif kind == "menu" then
        if self.show_dashboard_menu then self.show_dashboard_menu(self) end
    elseif kind == "search" then
        self:promptSearch({})
    elseif kind == "book" then
        self:onMenuSelect({ kind = "dashboard-book", book_id = action.book.id, book = action.book, resume = action.resume, list = action.list })
    elseif kind == "detail" then
        self:loadBookDetail(action.book_id, { list = action.list })
    elseif kind == "highlight" then
        require("bookorbit_highlight_sheet").open(self, action.highlight)
    elseif kind == "books" then
        self:loadBooks(action.params or {}, action.title)
    elseif kind == "shelf" then
        self:boardOpenShelf(action)
    elseif kind == "shuffle" then
        self:boardShuffle()
    elseif kind == "link" then
        self:boardOpenLink(action.link)
    elseif kind == "lookup" then
        self:boardLookup(action.word)
    elseif kind == "light" then
        self:boardAdjustLight(action.what, action.delta)
    elseif kind == "wifi" then
        self:boardToggleWifi()
    elseif kind == "night" then
        UIManager:broadcastEvent(Event:new("ToggleNightMode"))
        self:updateItems(nil, true)
    elseif kind == "frontlight" then
        UIManager:broadcastEvent(Event:new("ShowFlDialog"))
    elseif kind == "rotate" then
        UIManager:broadcastEvent(Event:new("IterateRotation"))
    elseif kind == "sync" then
        if self._manager and self._manager.startSweep then self._manager:startSweep() end
    elseif kind == "dust-next" then
        self:boardDustNext()
    elseif kind == "dust-remove" then
        self:boardDustRemove(action.book)
    end
end

-- Gathering dust: show the next unopened book for the rest of today.
function CatalogBoard:boardDustNext()
    local today = os.date("%Y-%m-%d")
    local state = self.settings.catalog_board_dust
    local skip = type(state) == "table" and state.day == today and tonumber(state.skip) or 0
    self:persistSetting("catalog_board_dust", { day = today, skip = skip + 1 })
    for _i, entry in ipairs(self._board_tiles or {}) do
        if entry.item.type == "dust" then self:boardRefreshTile(entry) end
    end
end

-- Removes an unopened book's file through KOReader's file manager, which
-- asks first. The book stays in the library.
function CatalogBoard:boardDustRemove(book)
    local path = book and self:onDeviceBookPath(book)
    if not path then return end
    local FileManager = require("apps/filemanager/filemanager")
    local fm = FileManager.instance
    if not fm or not fm.showDeleteFileDialog then
        require("bookorbit_toast").error(_("Open the file browser to remove this book."))
        return
    end
    fm:showDeleteFileDialog(path, function()
        self:refreshOnDevice()
        BoardData.invalidateUnopened()
        self:updateItems(nil, true)
    end)
end

function CatalogBoard:boardFlip(delta)
    local context = self.current_context
    if not context then return true end
    local page = self:boardPage() + (delta or 0)
    if page < 1 or page > BoardStore.PAGE_COUNT then return true end
    context.board_page = page
    self:updateItems(nil, true)
    return true
end

local LINK_ACTIONS = {
    library = function(self) self:loadBooks({ sort = "title" }, _("All books")) end,
    series = function(self) self:loadSection("series") end,
    authors = function(self) self:loadSection("authors") end,
    collections = function(self) self:loadSection("collections") end,
    scopes = function(self) self:loadSection("smart-scopes") end,
    device = function(self) self:loadOnDevice() end,
    search = function(self) self:promptSearch({}) end,
}

function CatalogBoard:boardOpenLink(link)
    local fn = LINK_ACTIONS[link]
    if fn then fn(self) end
end

local SHELF_PARAMS = {
    ["recently-added"] = { sort = "recently_added" },
    ["pick-back-up"] = { readStatus = "reading", sort = "recently_read", order = "asc" },
    ["finished"] = { readStatus = "finished", sort = "recently_read" },
    ["in-progress"] = { sort = "recently_read", readStatus = "reading" },
    ["random"] = { sort = "title" },
}

function CatalogBoard:boardOpenShelf(action)
    if action.source == "up-next-in-series" then
        return self:loadSection("series")
    end
    local params = (action.props and action.props.params) or SHELF_PARAMS[action.source] or { sort = "title" }
    self:loadBooks(params, BoardWidgets.shelfTitle(action.props or {}))
end

function CatalogBoard:boardShuffle()
    self:runConnected(function()
        local body, err = self:fetch(_("Finding books..."), function()
            return self.client:catalogDiscover()
        end)
        if body and body.discover then
            local dashboard = self.current_context and self.current_context.dashboard
            if dashboard then
                dashboard.boardShelves = dashboard.boardShelves or {}
                dashboard.boardShelves.random = body.discover
                dashboard.discover = body.discover
                self:cacheDashboard(dashboard)
                self:scheduleThumbnailDownloads(body.discover)
            end
            self:updateItems(nil, true)
        elseif err and err ~= "cancelled" then
            self:showServerError(err)
        end
    end)
end

function CatalogBoard:boardLookup(word)
    local FileManager = require("apps/filemanager/filemanager")
    local fm = FileManager.instance
    if fm and fm.dictionary and fm.dictionary.onLookupWord then
        fm.dictionary:onLookupWord(word)
    end
end

function CatalogBoard:boardAdjustLight(what, delta)
    if not Device:hasFrontlight() then return end
    local powerd = Device:getPowerDevice()
    if what == "warmth" and Device:hasNaturalLight() then
        powerd:setWarmth(math.max(0, math.min(100, (powerd:frontlightWarmth() or 0) + delta)))
    else
        powerd:setIntensity(math.max(0, math.min(100, (powerd:frontlightIntensity() or 0) + delta)))
    end
    for _i, entry in ipairs(self._board_tiles or {}) do
        if entry.item.type == "light" then self:boardRefreshTile(entry) end
    end
end

function CatalogBoard:boardToggleWifi()
    if NetworkMgr:isWifiOn() then
        NetworkMgr:toggleWifiOff(function() self:updateItems(nil, true) end)
    else
        NetworkMgr:toggleWifiOn(function() self:updateItems(nil, true) end)
    end
end

-- ------------------------------------------------------------ sources
-- The shelves and names the board's pages show, so a refresh fetches only
-- what some widget will draw.
function CatalogBoard:boardSources()
    local m = BoardMetrics.get()
    local cols = BoardLayout.columnsFor(m.LW)
    local sources, names = {}, {}
    local all_pages = {}
    for _i, page in ipairs(self:boardPages(cols)) do table.insert(all_pages, page) end
    -- Before the first run every starter layout is previewed, so each one
    -- needs its shelves.
    if not BoardStore.read(self.settings).started then
        for _i, preset in ipairs(BoardStore.PRESETS) do
            for _j, page in ipairs(BoardStore.starterPages(cols, preset, self:boardHasLight(), self:boardLandscape())) do table.insert(all_pages, page) end
        end
    end
    -- Widgets added while editing count too.
    if self.board_edit then
        for _i, page in ipairs(self.board_edit.pages) do table.insert(all_pages, { base = page.items }) end
    end
    for _i, page in ipairs(all_pages) do
        for _i, list in ipairs({ page.base, page.extras }) do
            for _i, item in ipairs(list or {}) do
                if item.type == "shelf" and item.props and item.props.source then
                    sources[BoardStore.shelfKey(item.props)] = item.props
                elseif item.type == "link" and item.props then
                    if item.props.link == "collections" or item.props.link == "scopes" then names[item.props.link] = true end
                    if item.props.link == "series" then sources["up-next-in-series"] = sources["up-next-in-series"] or { source = "up-next-in-series" } end
                    if item.props.link == "library" or item.props.link == "authors" then sources["recently-added"] = sources["recently-added"] or { source = "recently-added" } end
                elseif item.type == "hero" then
                    sources["random"] = sources["random"] or { source = "random" }
                elseif item.type == "dust" then
                    sources["unopened"] = sources["unopened"] or { source = "unopened" }
                end
            end
        end
    end
    return sources, names
end

-- ------------------------------------------------------------ parity dump
-- With BO_BOARD_DUMP set (a directory), each render writes the data and page
-- it drew in the design mock's shape, so the mock can draw the same board
-- and the two can be compared pixel for pixel. Development only.
local DUMP_DIR = os.getenv("BO_BOARD_DUMP")

local function jsonValue(v, depth)
    depth = depth or 0
    local t = type(v)
    if v == nil then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        return tostring(v)
    end
    if t == "string" then
        return '"' .. v:gsub('[%c"\\]', function(ch)
            if ch == '"' then return '\\"' end
            if ch == "\\" then return "\\\\" end
            if ch == "\n" then return "\\n" end
            return string.format("\\u%04x", ch:byte())
        end) .. '"'
    end
    if t == "table" then
        if depth > 8 then return "null" end
        local n = #v
        if n > 0 or next(v) == nil then
            local parts = {}
            for i = 1, n do parts[i] = jsonValue(v[i], depth + 1) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local parts = {}
        for k, val in pairs(v) do
            if type(k) == "string" and type(val) ~= "function" then
                table.insert(parts, jsonValue(k) .. ":" .. jsonValue(val, depth + 1))
            end
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end

local function mockBook(b)
    if type(b) ~= "table" then return nil end
    return {
        id = b.id, title = b.title, authors = b.authors, seriesName = b.seriesName, seriesIndex = b.seriesIndex,
        progressPercentage = b.progressPercentage, lastReadAt = b.lastReadAt, readStatus = b.readStatus,
        onDevice = b.on_device == true, minutesLeft = b.minutes_left and math.floor(b.minutes_left + 0.5) or nil,
        lastRead = b.last_read, coverPath = b.cover_path,
        coverAspect = b.cover_path and BoardUI.nativeAspect(b.cover_path) or nil,
    }
end

local function mockBooks(list)
    local out = {}
    for _i, b in ipairs(list or {}) do table.insert(out, mockBook(b)) end
    return out
end

function CatalogBoard:boardDump(d, page)
    if not DUMP_DIR then return end
    local now = d.now
    local t = os.date("*t", now)
    local first = os.time({ year = t.year, month = t.month, day = 1, hour = 12 })
    local days = tonumber(os.date("%d", os.time({ year = t.year, month = t.month + 1, day = 0, hour = 12 })))
    local read = {}
    for day = 1, days do
        local key_t = os.time({ year = t.year, month = t.month, day = day, hour = 12 })
        local idx = math.floor((key_t - d.heatmap_start) / 86400 + 0.5) + 1
        read[day] = day <= t.day and (d.heatmap[idx] or 0) > 0
    end
    local heat = {}
    for i = 1, BoardData.HEATMAP_DAYS do heat[i] = d.heatmap[i] == nil and false or d.heatmap[i] end
    local f = d.forecast
    local y = d.year_ago
    local powerd = Device:getPowerDevice()
    local data = {
        state = "normal",
        greetingFull = d.greeting, displayName = d.display_name, dateLong = d.date_long, clock = d.clock,
        weekday = d.weekday, dayMonth = d.day_month,
        battery = Device:hasBattery() and powerd:getCapacity() or nil,
        sync = { online = d.online, label = "", short = "" },
        syncWhen = d.last_sync_at and BoardData.relativeDay(os.date("!%Y-%m-%dT%H:%M:%SZ", d.last_sync_at), now) or (d.updated or "not yet"),
        updated = d.updated,
        totalBooks = d.counts.library,
        counts = { onDevice = d.counts.device, inProgress = d.counts.in_progress, libraries = d.counts.libraries, authors = d.counts.authors,
            series = d.counts.series, collections = d.counts.collections, smartScopes = d.counts.scopes },
        continueReading = mockBooks(d.continue_reading),
        discover = mockBooks(d.shelves["random"]),
        discover2 = mockBooks(d.shelves["random"]),
        recentlyAdded = mockBooks(d.shelves["recently-added"]),
        upNext = mockBooks(d.shelves["up-next-in-series"]),
        upNextAll = mockBooks(d.shelves["up-next-in-series"]),
        wantToRead = mockBooks(d.shelves["want-to-read"]),
        pickUp = mockBooks(d.shelves["pick-back-up"]),
        finished = mockBooks(d.shelves["finished"]),
        hours = d.hours or {},
        records = d.records and { longestSessionMin = d.records.longest_min, avgSessionMin = d.records.avg_min,
            sessions = d.records.sessions, pagesPerHour = d.records.pages_per_hour } or nil,
        goal = { goalBooks = d.goal.books, completedBooks = d.goal.done, year = d.goal.year },
        streak = { currentStreak = d.streak.current, longestStreak = d.streak.longest, lastSevenDays = d.streak_week },
        highlight = d.highlight,
        heatmap = heat,
        heatmapStart = os.date("%Y-%m-%d", d.heatmap_start),
        week = d.week, weekdayInitials = d.week_initials, todayMin = d.today_min, weekMin = d.week_min,
        forecast = f and { book = mockBook(f.book), day = f.day, short = f.short, date = f.date, daysOut = f.days_out, perDay = math.floor(f.per_day + 0.5),
            initials = (function()
                local out = {}
                for i = 1, math.min(8, f.days_out + 1) do out[i] = BoardData.shortWeekday(now + (i - 1) * 86400):sub(1, 1) end
                return out
            end)() } or nil,
        yearAgo = y and { book = mockBook(y.book), when = y.when, minutes = y.minutes, days = y.days, stoppedAt = y.stopped_at } or nil,
        word = d.word,
        light = d.light,
        dayOfYear = d.day_of_year,
        collectionNames = d.names.collections or {},
        scopeNames = d.names.scopes or {},
        recentSearches = d.recent_searches or {},
        storage = d.storage and { free = tonumber(string.format("%.1f", d.storage.free_gb)), total = math.floor(d.storage.total_gb + 0.5) } or nil,
        calendar = { lead = tonumber(os.date("%w", first)), days = days, today = t.day, read = read, month = BoardData.longMonth(now) },
    }
    local m = BoardMetrics.get()
    local rects = {}
    for _i, entry in ipairs(self._board_tiles or {}) do
        local o = self._board_origin
        table.insert(rects, { type = entry.item.type, x = o.x + entry.x, y = o.y + entry.y, w = entry.w, h = entry.h })
    end
    local doc = { data = data, page = page, w = m.w, h = m.h, dpi = Screen:getDPI(), tiles = BoardStore.read(self.settings).tiles,
        preset = BoardStore.read(self.settings).preset, rects = rects }
    local f_out = io.open(DUMP_DIR .. "/board-dump.json", "w")
    if f_out then f_out:write(jsonValue(doc)); f_out:close() end
end

CatalogBoard.TitleBarStub = TitleBarStub

function CatalogBoard.install(Catalog)
    BoardEdit.install(Catalog)
    for name, fn in pairs(CatalogBoard) do
        if name ~= "install" and type(fn) == "function" then
            Catalog[name] = fn
        end
    end
end

return CatalogBoard
