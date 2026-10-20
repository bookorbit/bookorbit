--[[--
A book's long text on BookOrbit pages: About this book and Highlights, plus
the Genres & tags sheet.

Text turns page by page like a book, never scrolls: the list pager at the
foot, swipes and the page keys move through it. The header names the book
the page belongs to, so its back button says where it goes.
]]

local Device = require("device")
local TextBoxWidget = require("ui/widget/textboxwidget")
local UIManager = require("ui/uimanager")
local datetime = require("datetime")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DetailData = require("bookorbit_detail_data")
local DialogUI = require("bookorbit_dialog_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px, lh = BoardMetrics.px, BoardMetrics.lh
local text, vstack, hstack, space, flex, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space, BoardUI.flex, BoardUI.icon

local TextPages = {}

local function wOf(widget) return widget:getSize().w end
local function hOf(widget) return widget:getSize().h end

local BODY_SIZE = 16

-- How many lines str takes at width w.
local function linesNeeded(str, o, w)
    local tb = TextBoxWidget:new{ text = str, face = BoardMetrics.face(o.s, o.serif and (o.i and "serif_italic" or "serif") or (o.i and "sans_italic" or "sans")), width = w }
    local n = math.max(1, math.floor(tb:getSize().h / lh(o.s) + 0.5))
    tb:free()
    return n
end
TextPages.linesNeeded = linesNeeded

-- Splits n items of the given heights into pages no taller than page_h, gap
-- apart. An item taller than a page gets a page of its own.
function TextPages.pack(heights, page_h, gap)
    local pages, first, used = {}, 1, 0
    for index, h in ipairs(heights) do
        local need = (index > first) and (gap + h) or h
        if index > first and used + need > page_h then
            table.insert(pages, { first = first, last = index - 1 })
            first, used = index, h
        else
            used = used + need
        end
    end
    if #heights >= first then table.insert(pages, { first = first, last = #heights }) end
    if #pages == 0 then pages = { { first = 1, last = 0 } } end
    return pages
end

-- ----------------------------------------------------------------- frame
-- The header: back with the book's title, the device status; then the
-- page's own title.
local function header(page, w)
    local box = px(44)
    local label = page.back_label or _("Back")
    local back_inner = hstack({ h = box, gap = px(2) }, { icon("chevron-left", px(24), { sw = 2.25 }), text(label, { s = 15, b = true, data = true }), space(px(8), 1) })
    local max_back = math.floor(w * 0.6)
    if wOf(back_inner) > max_back then
        back_inner = hstack({ h = box, gap = px(2) }, { icon("chevron-left", px(24), { sw = 2.25 }),
            text(label, { s = 15, b = true, w = max_back - px(24) - px(2) - px(8), data = true }), space(px(8), 1) })
    end
    local back = BoardUI.hit(back_inner, { kind = "back" })
    local status = BoardUI.statusCluster({ clock = datetime.secondsToHour(os.time(), G_reader_settings:isTrue("twelve_hour_clock")) })
    -- The chevron sits on the margin; its tap area reaches into it.
    local row = hstack({ w = w + px(8), h = px(48) }, { back, flex(0), status })
    return BoardUI.overlay(w, px(48), { { widget = row, x = -px(8), y = 0 } })
end

local function pager(w, index, count)
    local fh = px(40)
    local function chev(name, on, delta)
        local c = hstack({ w = px(44), h = fh }, { flex(0), icon(name, px(20), { sw = 2.5, col = on and "black" or "gb" }), flex(0) })
        return on and BoardUI.hit(c, { kind = "page", delta = delta }) or c
    end
    local mid = text(T(_("%1 of %2"), index, count), { s = 13, b = true })
    return hstack({ w = w, h = fh, gap = px(4) }, { flex(0), chev("chevron-left", index > 1, -1), space(px(6), 1), mid, space(px(6), 1), chev("chevron-right", index < count, 1), flex(0) })
end

TextPages.pager = pager

-- The page around a body: build_body(page, w, body_h) returns the body for
-- page.index and sets page.count.
local function buildPage(page, sw, sh)
    local mx = MenuUI.mx()
    local w = sw - 2 * mx
    local top, bottom = px(6), px(8)
    local head = header(page, w)
    local title = vstack({ w = w }, {
        text(page.title, { s = 22, b = true, w = w }),
        page.sub and text(page.sub, { s = 13, col = INK.g4, w = w, data = true }) or false,
    })
    local fixed = top + hOf(head) + px(4) + hOf(title) + px(14) + px(8) + px(40) + bottom
    local body_h = sh - fixed
    local body = page.build_body(page, w, body_h)
    local items = { head, space(nil, px(4)), title, space(nil, px(14)), vstack({ w = w, h = body_h }, { body, flex(0) }), space(nil, px(8)) }
    if (page.count or 1) > 1 then
        table.insert(items, pager(w, page.index, page.count))
    else
        table.insert(items, space(nil, px(40)))
    end
    return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, items)
end

local function turn(page, delta)
    local next_index = math.max(1, math.min(page.count or 1, page.index + delta))
    if next_index == page.index then return end
    page.index = next_index
    page:refresh(Device:hasEinkScreen() and "partial" or "ui")
end

local function openPage(o)
    local page = MenuPage:new{
        name = o.name,
        build = buildPage,
        on_action = function(page, action)
            if action.kind == "page" then turn(page, action.delta) end
            return true
        end,
        on_swipe = function(page, ges)
            if ges.direction == "west" then turn(page, 1) return true end
            if ges.direction == "east" then turn(page, -1) return true end
            return false
        end,
        on_page_key = function(page, delta) turn(page, delta) end,
        title = o.title,
        sub = o.sub,
        back_label = o.back_label,
        build_body = o.build_body,
        index = 1,
    }
    UIManager:show(page, "ui")
    return page
end

-- The book's title as the back button says it: short, without a subtitle.
function TextPages.backLabel(title)
    title = tostring(title or "")
    title = title:gsub("%s*[:(].*$", "")
    if title == "" then return _("Back") end
    return title
end

-- -------------------------------------------------------------- about
function TextPages.about(detail, text_)
    local description = DetailData.cleanDescription(text_ or detail.description) or _("Nothing to show.")
    local state = {}
    return openPage{
        name = "bookorbit_about_book",
        title = _("About this book"),
        back_label = TextPages.backLabel(detail.title),
        build_body = function(page, w, body_h)
            local line = lh(BODY_SIZE)
            local per_page = math.max(1, math.floor(body_h / line))
            if not state.total or state.w ~= w then
                state.w = w
                state.total = linesNeeded(description, { s = BODY_SIZE, serif = true }, w)
            end
            page.count = math.max(1, math.ceil(state.total / per_page))
            if page.index > page.count then page.index = page.count end
            return TextBoxWidget:new{
                text = description,
                face = BoardMetrics.face(BODY_SIZE, "serif"),
                width = w,
                height = per_page * line,
                virtual_line_num = (page.index - 1) * per_page + 1,
                fgcolor = INK.black,
                bgcolor = INK.white,
            }
        end,
    }
end

-- ---------------------------------------------------------- highlights
-- One highlight: the quote set like the detail page sets it, a rule down
-- its left edge, where and when, and the note in a gray box.
function TextPages.quote(hl, w)
    local bar = math.max(2, px(3))
    local pad = px(14)
    local tw = w - bar - pad
    local view = DetailData.highlightView(hl) or {}
    local quote_lines = math.min(14, linesNeeded(view.text or "", { s = BODY_SIZE, serif = true, i = true }, tw))
    local items = {
        text(view.text or "", { s = BODY_SIZE, i = true, serif = true, lines = quote_lines, w = tw, data = true }),
    }
    local meta = {}
    if view.chapter then table.insert(meta, { t = view.chapter, b = true, col = INK.g2 }) end
    if view.when then table.insert(meta, { t = (#meta > 0 and " · " or "") .. view.when, col = INK.g4 }) end
    if #meta > 0 then
        table.insert(items, space(nil, px(6)))
        table.insert(items, BoardUI.runs(meta, { s = 12, w = tw, data = true }))
    end
    if view.note then
        local nw = tw - 2 * px(12) - px(16) - px(8)
        local note_lines = math.min(8, linesNeeded(view.note, { s = 14 }, nw))
        local note = text(view.note, { s = 14, w = nw, lines = note_lines, data = true, bg = INK.ge })
        local inner = hstack({ w = tw - 2 * px(12), gap = px(8), valign = "top" }, { icon("pen-line", px(16), { sw = 2.25 }), note })
        table.insert(items, space(nil, px(8)))
        table.insert(items, BoardUI.box({ w = tw, h = hOf(inner) + 2 * px(10), radius = px(8), bg = INK.ge }, vstack({ w = tw, pad = { px(10), px(12), px(10), px(12) } }, { inner })))
    end
    local body = vstack({ w = tw }, items)
    return hstack({ w = w, valign = "top" }, { BoardUI.rect(bar, hOf(body), INK.black, math.floor(bar / 2)), space(pad, 1), body })
end

function TextPages.highlights(detail, hl)
    local items = hl and hl.items or {}
    local gap = px(18)
    local state = {}
    return openPage{
        name = "bookorbit_book_highlights",
        title = _("Highlights"),
        sub = T(_("%1 in this book"), hl and hl.count or #items),
        back_label = TextPages.backLabel(detail.title),
        build_body = function(page, w, body_h)
            if not state.pages or state.w ~= w or state.h ~= body_h then
                local heights = {}
                for _i, item in ipairs(items) do
                    local q = TextPages.quote(item, w)
                    table.insert(heights, math.min(hOf(q), body_h))
                    q:free()
                end
                state.pages, state.w, state.h = TextPages.pack(heights, body_h, gap), w, body_h
            end
            page.count = #state.pages
            if page.index > page.count then page.index = page.count end
            local range = state.pages[page.index]
            local blocks = {}
            for index = range.first, range.last do
                if #blocks > 0 then table.insert(blocks, space(nil, gap)) end
                table.insert(blocks, TextPages.quote(items[index], w))
            end
            return vstack({ w = w }, blocks)
        end,
    }
end

-- --------------------------------------------------------- genres & tags
-- Labels, not buttons: the catalog cannot list books by genre yet.
function TextPages.tags(detail)
    local function list(values)
        local out = {}
        for _i, v in ipairs(values or {}) do
            if type(v) == "string" and v:match("%S") then table.insert(out, (v:gsub("^%s+", ""):gsub("%s+$", ""))) end
        end
        return out
    end
    local genres, tags = list(detail.genres), list(detail.tags)
    local build = function(page, sw, sh)
        return DialogUI.sheet(page, sw, sh, function(w)
            local items = { DialogUI.titleRow(w, _("Genres & tags"), detail.title) }
            local function chips(values)
                local widgets = {}
                for _i, v in ipairs(values) do table.insert(widgets, DialogUI.labelChip(v, w)) end
                return DialogUI.wrap(w, widgets, px(8))
            end
            if #genres > 0 then
                table.insert(items, DialogUI.section(w, _("Genres"), chips(genres), text(tostring(#genres), { s = 13, col = INK.g4 })))
            end
            if #tags > 0 then
                table.insert(items, DialogUI.section(w, _("Tags"), chips(tags), text(tostring(#tags), { s = 13, col = INK.g4 })))
            else
                table.insert(items, DialogUI.note(w, "tag", _("No tags on this book yet. Tags added in BookOrbit show here."), { col = INK.g4 }))
            end
            return items
        end, { pop_w = 460 })
    end
    return DialogUI.open{ name = "bookorbit_genres_tags", build = build }
end

return TextPages
