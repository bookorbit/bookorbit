--[[--
The book detail page, drawn from the view model in bookorbit_detail_data.

Two pages. The main page is the jacket (the cover beside the book's series,
title, author, rating and status, where the reader stands, and the action),
then the key facts, the description, genres, the series path and a shelf.
More details holds everything else. Below the jacket, sections are fitted to
the screen by priority and the description takes the room that is left, so
a page never scrolls and never ends in a hole.

Sizes are the design mock's dp values through BoardMetrics, so the page and
the mock lay out with the same pixels. Every control is its own tappable,
focusable region: a D-pad press is a tap at the focused region's centre.
]]

local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local TextBoxWidget = require("ui/widget/textboxwidget")
local Widget = require("ui/widget/widget")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local BD = require("ui/bidi")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local CatalogWidgets = require("bookorbit_catalog_widgets")
local DetailData = require("bookorbit_detail_data")

local INK = BoardMetrics.INK
local px, lh1, lh = BoardMetrics.px, BoardMetrics.lh1, BoardMetrics.lh
local text, runs, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.runs, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local DetailView = {}

local DEBUG = os.getenv("BO_DETAIL_DEBUG") ~= nil

local function hair() return math.max(1, px(0.75)) end
local function line1() return math.max(1, px(1)) end

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

-- The screen's width in dp. KOReader rounds its scale up at the sixth
-- decimal, so a 600 dp screen measures 599.9994; thresholds compare the
-- rounded value, as the design mock does.
local function screenW()
    return BoardMetrics.layoutW()
end

local function wOf(widget) return widget:getSize().w end
local function hOf(widget) return widget:getSize().h end

-- ----------------------------------------------------------------- regions
-- A tappable, focusable piece of the page. Built inside a view build, it is
-- recorded in the focus row it belongs to.
local Region = InputContainer:extend{
    action = nil,
    run = nil,
}

function Region:init()
    local size = self[1]:getSize()
    self.dimen = Geom:new{ w = size.w, h = size.h }
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = function() return self.dimen end } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = function() return self.dimen end } },
    }
end

function Region:handleEvent(event)
    if event.handler == "onTapSelect" or event.handler == "onHoldSelect" then
        return Widget.handleEvent(self, event)
    end
    return InputContainer.handleEvent(self, event)
end

function Region:onTapSelect()
    if self.action and self.run then self.run(self.action, self) end
    return true
end

function Region:onHoldSelect()
    if self.action and self.run then self.run(self.action, self, true) end
    return true
end

local build_ctx = nil

-- Wraps widget as a control. row: the focus row it joins (rows are walked top
-- to bottom by D-pad); key: a name to find it again (partial refreshes).
local function region(widget, action, row, key)
    local r = Region:new{ action = action, run = build_ctx and build_ctx.run, CatalogWidgets.focusable(widget) }
    if build_ctx and row then
        local rows = build_ctx.rows
        rows[row] = rows[row] or {}
        table.insert(rows[row], r)
        if not build_ctx.row_order[row] then
            build_ctx.row_order[row] = true
            table.insert(build_ctx.row_list, row)
        end
    end
    if build_ctx and key then build_ctx.regions[key] = r end
    return r
end

-- A transparent wrapper that remembers where it was painted, for the parity
-- dump. Only built when the dump is on.
local MARKS = os.getenv("BO_DETAIL_DUMP") ~= nil
local Mark = WidgetContainer:extend{ key = nil }
function Mark:getSize() return self[1]:getSize() end
function Mark:paintTo(bb, x, y)
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self[1]:paintTo(bb, x, y)
end
function Mark:free() if self[1].free then self[1]:free() end end
local function mark(key, widget)
    if not MARKS or not build_ctx or not widget then return widget end
    local m = Mark:new{ key = key, widget }
    build_ctx.regions[key] = m
    return m
end
DetailView.mark = mark

-- -------------------------------------------------------------- text tools
local lines_cache, lines_count = {}, 0

-- How many lines a text block takes at a width (TextBoxWidget wraps the
-- same way it will paint).
local function linesNeeded(str, o, width)
    local key = table.concat({ tostring(str), o.s or 14, tostring(o.b), tostring(o.serif), width, BoardMetrics.get().dp }, "|")
    if lines_cache[key] then return lines_cache[key] end
    local face_kind = o.serif and (o.i and "serif_italic" or "serif") or (o.i and "sans_italic" or "sans")
    local tb = TextBoxWidget:new{
        text = BD.auto(tostring(str or "")),
        face = BoardMetrics.face(o.s or 14, face_kind),
        bold = o.b == true,
        width = width,
    }
    local n = math.max(1, math.floor(tb:getSize().h / lh(o.s or 14) + 0.5))
    tb:free()
    if lines_count > 300 then lines_cache, lines_count = {}, 0 end
    lines_cache[key] = n
    lines_count = lines_count + 1
    return n
end
DetailView.linesNeeded = linesNeeded

-- The narrowest box that keeps the same line count: a title never strands
-- one word on its last line.
local function balancedWidth(str, o, width, lines)
    if lines <= 1 then return width end
    -- Never narrower than the widest word with its punctuation, or a line
    -- would start on the comma after it.
    local widest = 0
    for word in tostring(str or ""):gmatch("%S+") do
        local w = text(word, o)
        widest = math.max(widest, wOf(w))
        if w.free then w:free() end
    end
    local lo, hi = math.min(width, math.max(math.floor(width * 0.5 + 0.5), widest + px(2))), width
    while hi - lo > 4 do
        local mid = math.floor((lo + hi) / 2 + 0.5)
        if linesNeeded(str, o, mid) <= lines then hi = mid else lo = mid end
    end
    return hi
end

local function textWidth(str, o)
    local w = text(str, o)
    local width = wOf(w)
    if w.free then w:free() end
    return width
end

-- The first string in `options` whose single line fits `width`.
local function firstFitting(options, o, width)
    for _i, option in ipairs(options) do
        if option and textWidth(option, o) <= width then return option end
    end
    return options[#options]
end

-- ----------------------------------------------------------------- pieces
local function rule(w, col)
    return BoardUI.rect(w, hair(), col or INK.gc)
end

-- A pill button. o: kind ("solid", "outline", "disabled"), icon, label, w,
-- h, s, icon_size, pad_r, after (a trailing widget), ring.
local function pill(o)
    local h = o.h or px(46)
    local solid, off = o.kind == "solid", o.kind == "disabled"
    local fg = solid and "white" or off and "g6" or "black"
    local fg_ink = solid and INK.white or off and INK.g6 or INK.black
    local items = {}
    if o.icon then
        table.insert(items, icon(o.icon, px(o.icon_size or 18), { col = fg, sw = 2.25, fill = o.icon == "play" }))
    end
    if o.label then
        local text_w = o.text_w
        table.insert(items, text(o.label, { s = o.s or 15, b = true, col = fg_ink, w = text_w }))
    end
    if o.after then table.insert(items, o.after) end
    local ring = (solid or off) and 0 or math.max(1, px(o.ring or 1.5))
    local inner = hstack({ gap = px(8) }, items)
    local pad_l = o.label and px(o.icon and 16 or 20) or 0
    local pad_r = o.label and px(o.pad_r or 20) or 0
    local w = o.w or (o.label and (pad_l + wOf(inner) + pad_r) or h)
    local content = hstack({ w = w - 2 * ring, h = h - 2 * ring }, { flex(0), inner, flex(0) })
    return BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), border = ring, border_col = INK.black,
        bg = solid and INK.black or off and INK.ge or INK.white }, content)
end
DetailView.pill = pill

local STATUS_ICONS = { read = "book-check", reading = "book-open", rereading = "book-open", want_to_read = "bookmark",
    on_hold = "circle-pause", abandoned = "x", unread = "bookmark" }

local function statusPill(d, o)
    o = o or {}
    return pill({ kind = "outline", icon = not o.no_icon and (STATUS_ICONS[d.status] or "bookmark") or nil,
        label = d.status_label, after = icon("chevron-down", px(16), { sw = 2.5 }), h = o.h, s = o.s or 14,
        icon_size = 16, pad_r = 14 })
end

local function starsRow(d, size, gap, row_key)
    local items = {}
    for i = 1, 5 do
        local on = i <= (d.rating or 0)
        local star = icon("star", size, { sw = 1.75, col = on and "black" or "g8", fill = on })
        table.insert(items, row_key and region(star, { kind = "rate", value = i }, row_key) or star)
    end
    return hstack({ gap = gap }, items)
end

-- Stars, then the status pill; the stars shrink and the pill loses its icon
-- before anything collides.
local function verdictRow(d, w)
    local function build(star, no_icon, live)
        local stars = starsRow(d, px(star), px(star >= 20 and 4 or 3), live and "verdict" or nil)
        local status = statusPill(d, { h = px(36), s = 13, no_icon = no_icon })
        if live then status = region(status, { kind = "verdict" }, "verdict", "status-pill") end
        return stars, status
    end
    local choice = { 16, true }
    for _i, variant in ipairs({ { 20, false }, { 20, true }, { 17, true } }) do
        local stars, status = build(variant[1], variant[2], false)
        if wOf(stars) + wOf(status) + 2 * px(10) <= w then choice = variant; break end
    end
    local stars, status = build(choice[1], choice[2], true)
    return hstack({ w = w, gap = px(10) }, { stars, flex(0), status })
end

local function primaryButton(d, o)
    o = o or {}
    local p = d.primary
    local h = o.h or px(46)
    local w = o.w
    if p.kind == "downloading" then
        w = w or px(260)
        local ring = math.max(1, px(1.5))
        local fill = math.floor(w * (p.pct or 0) / 100 + 0.5)
        local lead = p.pct and (tostring(p.pct) .. "%") or _("Downloading")
        local label = runs({ { t = lead, b = true }, { t = p.sub and (" " .. p.sub) or "", col = INK.g3 } }, { s = 14 })
        local cancel = BoardUI.circle(px(32), { border = line1(), bg = INK.white }, icon("x", px(16), { sw = 2.5 }))
        local row = hstack({ w = w - 2 * ring, h = h - 2 * ring }, { space(px(18) - ring, 1), label, flex(0), cancel, space(px(8) - ring, 1) })
        local track = BoardUI.overlay(w - 2 * ring, h - 2 * ring, {
            { widget = BoardUI.rect(math.max(0, fill - ring), h - 2 * ring, INK.gc), x = 0, y = 0 },
            { widget = row, x = 0, y = 0 },
        })
        return BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), border = ring, border_col = INK.black, bg = INK.white }, track)
    end
    local kind = (p.kind == "offline" or p.kind == "none") and "disabled" or "solid"
    local labels = p.labels or { "" }
    local label = labels[1]
    if w then
        local room = w - px(16) - px(20) - (p.icon and (px(18) + px(8)) or 0)
        label = firstFitting(labels, { s = o.s or 15, b = true }, room)
    end
    return pill({ kind = kind, icon = p.icon, label = label, w = w, h = h, s = o.s })
end

-- Redraws the action button in place at its current size (download progress).
function DetailView.refreshPrimary(primary_region, primary)
    local size = primary_region.dimen
    primary_region[1] = CatalogWidgets.focusable(primaryButton({ primary = primary }, { w = size.w, h = size.h, s = 14 }))
end

local function detailsButton(short, h)
    return pill({ kind = "outline", icon = "info", label = not short and _("Details") or nil, h = h or px(46), s = 14, icon_size = 18, pad_r = 16 })
end

local function sectionHead(w, label, right, s)
    s = s or 14
    local left = text(label, { s = s, b = true, data = true })
    local right_w = nil
    if right then
        right_w = hstack({ gap = px(2) }, { text(right, { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) })
    end
    local max_left = w - (right_w and (wOf(right_w) + px(4)) or 0)
    if wOf(left) > max_left then left = text(label, { s = s, b = true, w = max_left, data = true }) end
    return hstack({ w = w, h = lh1(s) }, { left, flex(0), right_w })
end

-- --------------------------------------------------------------- the header
function DetailView.header(d, w, o)
    o = o or {}
    local box = px(44)
    local back_inner = hstack({ h = box, gap = px(2) }, { icon("chevron-left", px(24), { sw = 2.25 }), text(o.back or d.back or _("Back"), { s = 15, b = true, w = nil, data = true }), space(px(8), 1) })
    local back_w = math.min(wOf(back_inner), math.floor(w * 0.45))
    if wOf(back_inner) > back_w then
        back_inner = hstack({ h = box, gap = px(2) }, { icon("chevron-left", px(24), { sw = 2.25 }),
            text(o.back or d.back or _("Back"), { s = 15, b = true, w = back_w - px(24) - px(2) - px(8), data = true }), space(px(8), 1) })
    end
    local back = region(back_inner, { kind = "back" }, "header", "back")
    local more = region(hstack({ w = box, h = box }, { flex(0), icon("ellipsis", px(24), { sw = 2.25 }), flex(0) }), { kind = "menu" }, "header", "menu")
    local status = DetailView.statusRegion(d)
    -- The tap areas reach into the margin so the glyphs sit on it.
    local row = hstack({ w = w + px(8) + px(10), h = px(48) }, { back, flex(0), status, space(px(10), 1), more })
    local layers = { { widget = row, x = 0, y = 0 } }
    if o.center then
        local c = text(o.center, { s = 15, b = true })
        table.insert(layers, { widget = c, x = math.floor((w + px(8) + px(10) - wOf(c)) / 2), y = math.floor((px(48) - hOf(c)) / 2) })
    end
    return BoardUI.overlay(w + px(8) + px(10), px(48), layers)
end

-- The device status in a region of its own, so the clock can be redrawn
-- without the page.
function DetailView.statusRegion(d)
    local widget = BoardUI.statusCluster(d)
    local r = Region:new{ widget }
    if build_ctx then build_ctx.regions.status = r end
    return r
end

function DetailView.refreshStatus(status_region, d)
    status_region[1] = BoardUI.statusCluster(d)
end

function DetailView.offlineNotice(d, w)
    local inner = hstack({ h = px(32), gap = px(8) }, {
        space(px(12) - px(8), 1),
        icon("cloud-off", px(16), { sw = 2.25, col = "g3" }),
        runs({ { t = _("Offline"), b = true, col = INK.black }, { t = " · " .. (d.saved_note or _("Changes sync when you're back.")), col = INK.g3 } }, { s = 12, w = w - px(48) }),
    })
    return BoardUI.box({ w = w, h = px(32), radius = px(16), bg = INK.ge }, inner)
end

-- ---------------------------------------------------------------- the pager
-- ‹ previous book · 3 of 7 · next book ›
function DetailView.pager(d, w)
    local p = d.pager
    if not p then return nil end
    local fh = px(48)
    local label = p.label or ""
    local mid_w = math.floor(clamp(textWidth(label, { s = 11 }) + px(12), px(92), w * 0.36) + 0.5)
    local side_w = math.floor((w - mid_w) / 2)
    local function side(dir, title)
        if not title then return space(side_w, 1) end
        local chev = icon(dir == "l" and "chevron-left" or "chevron-right", px(20), { sw = 2.5 })
        local room = side_w - px(20) - px(4)
        local t = text(title, { s = 13, b = true, data = true })
        if wOf(t) > room then t = text(title, { s = 13, b = true, w = room, data = true }) end
        local items = dir == "l" and { chev, t, flex(0) } or { flex(0), t, chev }
        return region(hstack({ w = side_w, h = fh, gap = px(4) }, items), { kind = "page", delta = dir == "l" and -1 or 1 }, "pager")
    end
    local mid = vstack({ w = mid_w, align = "center" }, {
        text(T(_("%1 of %2"), p.index, p.total), { s = 13, b = true }),
        text(label, { s = 11, col = INK.g4, w = mid_w, align = "center", data = true }),
    })
    local row = hstack({ w = w, h = fh - hair() }, { side("l", p.prev), mid, side("r", p.next) })
    return vstack({ w = w }, { rule(w, INK.gb), row })
end

-- ------------------------------------------------------------- the jacket
local function kicker(d, w)
    if not d.kicker then return nil end
    local chev = icon("chevron-right", px(14), { sw = 2.5, col = "g3" })
    local t = text(d.kicker, { s = 13, b = true, col = INK.g3, data = true })
    if wOf(t) + px(2) + px(14) > w then t = text(d.kicker, { s = 13, b = true, col = INK.g3, w = w - px(2) - px(14), data = true }) end
    return region(hstack({ w = w }, { t, space(px(2), 1), chev, flex(0) }), { kind = "series" }, "jacket")
end

local function authorLine(d, w, s)
    local lines = d.author_lines or {}
    if #lines == 0 then return text(_("Author unknown"), { s = s, col = INK.g5, i = true, w = w }) end
    local t = firstFitting(lines, { s = s }, w)
    return text(t, { s = s, col = INK.g2, w = w, data = true })
end

-- Where the reader stands, sized for the column beside the cover: a big
-- percentage with time left and the finish day, or how it ended, or what
-- starting would take.
local function columnStanding(d, w)
    local p = d.progress
    local function two(a, b)
        return vstack({ w = w }, { text(a, { s = 14, b = true, w = w }), b and text(b, { s = 12, col = INK.g3, w = w }) or nil })
    end
    if d.status == "read" then
        if not d.finished or not d.finished.date then return nil end
        local j = d.journal
        local tail = j and firstFitting({ T(_("%1 over %2 days"), j.time, j.days), j.time }, { s = 12 }, w) or nil
        return two(T(_("Finished %1"), d.finished.date), tail)
    end
    if not p then
        if not d.not_started then return nil end
        local ns = d.not_started
        local options = {}
        if ns.estimate then
            table.insert(options, T(_("about %1 at your pace"), ns.estimate))
            table.insert(options, T(_("about %1"), ns.estimate))
        end
        table.insert(options, T(_("%1 pages"), ns.pages))
        return two(_("Not started"), firstFitting(options, { s = 12 }, w))
    end
    local big = text(p.label, { s = 26, b = true })
    local rw = w - wOf(big) - px(12)
    local left = p.left or (d.journal and d.journal.last_read and T(_("Last read %1"), d.journal.last_read)) or _("In progress")
    local lines
    if p.finish then
        lines = {
            { left, T(_("Finish %1, %2"), p.finish.day, p.finish.date) },
            { left, T(_("Finish %1"), p.finish.day) },
            { p.left_short or left, T(_("Done %1"), p.finish.day) },
            { p.left_short or left, nil },
        }
    else
        lines = { { left, p.page_short }, { p.left_short or left, nil } }
    end
    local pick = lines[#lines]
    for _i, l in ipairs(lines) do
        if textWidth(l[1], { s = 14, b = true }) <= rw and (not l[2] or textWidth(l[2], { s = 12 }) <= rw) then pick = l; break end
    end
    local right = vstack({ w = rw }, { text(pick[1], { s = 14, b = true, w = rw }), pick[2] and text(pick[2], { s = 12, col = INK.g3, w = rw }) or nil })
    return vstack({ w = w }, {
        hstack({ w = w, gap = px(12) }, { big, right }),
        space(nil, px(8)),
        BoardUI.bar(w, px(6), p.pct, { track = INK.gd, fill = INK.black, r = px(3) }),
    })
end

-- The action beside Details at full size: the spread's left page.
local function wideActions(d, w)
    local gap = px(10)
    local det = detailsButton(false, px(46))
    local dw = wOf(det)
    local primary = region(primaryButton(d, { w = w - dw - gap, h = px(46) }), { kind = "primary" }, "actions", "primary")
    return hstack({ w = w, gap = gap }, { primary, region(det, { kind = "details" }, "actions", "details") })
end

-- The action and Details side by side; Details folds to an icon when the
-- column is narrow.
local function columnActions(d, w)
    local gap = px(8)
    local h = px(44)
    local full = detailsButton(false, h)
    local probe = primaryButton(d, { h = h, s = 14 })
    local short = w - wOf(full) - gap < math.min(wOf(probe), px(200))
    local det = short and detailsButton(true, h) or full
    local dw = wOf(det)
    local primary = region(primaryButton(d, { w = w - dw - gap, h = h, s = 14 }), { kind = "primary" }, "actions", "primary")
    local details = region(det, { kind = "details" }, "actions", "details")
    return hstack({ w = w, gap = gap }, { primary, details })
end

-- The cover box: the same size on every book, so paging never moves the
-- frame. A cover of another shape keeps its own and sits inside, centred
-- across and hung from the top.
local function coverBox(d, box_w, box_h)
    return BoardUI.cover({ title = d.title }, box_w, box_h, {
        path = d.cover_path, border = line1(), border_col = INK.g6, loading = d.cover_state == "loading", valign = "top",
    })
end

local function jacketColumn(d, tw)
    local tf = BoardUI.fitTitle(d.title, { b = true }, tw, { 24, 22, 20, 18, 17 }, 3)
    local title_w = balancedWidth(d.title, { b = true, s = tf.s }, tw, tf.lines)
    local st = columnStanding(d, tw)
    local items = {}
    local k = kicker(d, tw)
    if k then table.insert(items, mark("kicker", k)); table.insert(items, space(nil, px(5))) end
    table.insert(items, mark("title", text(d.title, { s = tf.s, b = true, lines = tf.lines > 1 and tf.lines or nil, w = title_w, data = true })))
    if d.subtitle and tf.lines < 3 then
        table.insert(items, space(nil, px(2)))
        table.insert(items, text(d.subtitle, { s = 13, col = INK.g3, w = tw, data = true }))
    end
    table.insert(items, space(nil, px(4)))
    table.insert(items, mark("author", authorLine(d, tw, 15)))
    table.insert(items, space(nil, px(10)))
    table.insert(items, mark("verdict-row", verdictRow(d, tw)))
    -- Room the cover box leaves goes here: what the book is stays at the top,
    -- where you stand and what to do next sit on the box's bottom edge.
    table.insert(items, flex(px(12)))
    if st then table.insert(items, mark("standing", st)); table.insert(items, space(nil, px(12))) end
    table.insert(items, columnActions(d, tw))
    return items
end

-- The jacket: the cover box beside everything about the book's state. The
-- column is at least as tall as the box, so the actions meet its bottom edge.
function DetailView.jacket(d, w)
    local gut = px(16)
    local box_w = math.min(px(160), math.floor(w * 0.36 + 0.5))
    local box_h = math.floor(box_w * 1.5 + 0.5)
    local tw = w - box_w - gut
    -- The measuring pass builds without registering any controls.
    local saved = build_ctx
    build_ctx = nil
    local col_h = hOf(vstack({ w = tw }, jacketColumn(d, tw)))
    build_ctx = saved
    local column = vstack({ w = tw, h = math.max(box_h, col_h) }, jacketColumn(d, tw))
    return hstack({ w = w, valign = "top", gap = gut }, { region(coverBox(d, box_w, box_h), { kind = "cover" }, nil, "cover"), column })
end

-- -------------------------------------------------------------- the facts
local function specStrip(d, w)
    local items = d.spec or {}
    if #items == 0 then return nil end
    local gap, pad = px(12), px(12)
    local function need(v, l)
        return math.max(textWidth(v, { s = 15, b = true }), textWidth(l, { s = 12 })) + pad + hair()
    end
    local per = #items
    local cw = math.floor((w - (per - 1) * gap) / per)
    for _i, item in ipairs(items) do
        if need(item[1], item[2]) > cw then per = 2; break end
    end
    cw = math.floor((w - (per - 1) * gap) / per)
    local function cell(item, first)
        local inner_w = cw - (first and 0 or (pad + hair()))
        local body = vstack({ w = inner_w }, { text(item[1], { s = 15, b = true, w = inner_w, data = true }), text(item[2], { s = 12, col = INK.g4, w = inner_w }) })
        if first then return body end
        return hstack({}, { BoardUI.rect(hair(), hOf(body), INK.gc), space(pad, 1), body })
    end
    local rows = {}
    for k = 1, #items, per do
        local cells = {}
        for j = k, math.min(#items, k + per - 1) do table.insert(cells, cell(items[j], j == k)) end
        table.insert(rows, hstack({ w = w, gap = gap, valign = "top" }, cells))
        if k + per <= #items then table.insert(rows, space(nil, px(12))) end
    end
    return vstack({ w = w }, rows)
end

-- Genres and tags on `max_lines` lines; the last slot becomes +N.
local function chipRows(d, w, max_lines, row_key)
    local items = d.chips or {}
    if #items == 0 then return nil end
    local h, gap, s = px(30), px(8), 13
    local max_chip = math.floor(w * 0.6)
    local function chip(t, more)
        local tw = textWidth(t, { s = s, b = more })
        local clip = not more and tw > max_chip - 2 * px(12)
        local label = text(t, { s = s, b = more, col = more and INK.black or INK.g2, w = clip and (max_chip - 2 * px(12)) or nil, data = true })
        local w_ = wOf(label) + 2 * px(12)
        return BoardUI.box({ w = w_, h = h, radius = math.floor(h / 2), border = more and 0 or line1(), border_col = INK.g8, bg = more and INK.ge or INK.white },
            hstack({ w = w_ - 2 * (more and 0 or line1()), h = h - 2 * (more and 0 or line1()) }, { flex(0), label, flex(0) }))
    end
    local function widthOf(t, more) return math.min(textWidth(t, { s = s, b = more }), max_chip - 2 * px(12)) + 2 * px(12) end
    local lines, cur, used, i = {}, {}, 0, 1
    while i <= #items and #lines < max_lines do
        local cw = widthOf(items[i])
        local left = #items - i
        local is_last = #lines == max_lines - 1
        local reserve = (is_last and left > 0) and (gap + widthOf("+" .. left, true)) or 0
        if #cur > 0 and used + gap + cw + reserve > w then
            if is_last then break end
            table.insert(lines, cur); cur, used = {}, 0
        else
            table.insert(cur, items[i]); used = used + (#cur > 1 and gap or 0) + cw; i = i + 1
        end
    end
    if #cur > 0 then table.insert(lines, cur) end
    local rest = #items - (i - 1)
    local out = {}
    for li, ln in ipairs(lines) do
        local row = {}
        for _j, t in ipairs(ln) do table.insert(row, chip(t)) end
        if li == #lines and rest > 0 then table.insert(row, chip("+" .. rest, true)) end
        if li > 1 then table.insert(out, space(nil, gap)) end
        table.insert(out, hstack({ gap = gap }, row))
    end
    return region(vstack({ w = w }, out), { kind = "tags" }, row_key or "chips")
end

-- ------------------------------------------------------------ series path
local function seriesPath(s, w, o)
    o = o or {}
    local books = s.books
    local cur = s.current or 1
    local max_n = math.max(5, math.min(12, math.floor(w / px(46))))
    local first, last = 1, #books
    if #books > max_n then
        first = math.max(1, math.min(#books - max_n + 1, cur - math.floor(max_n / 2)))
        last = first + max_n - 1
    end
    local n = last - first + 1
    local D = math.min(px(o.dia or 34), math.floor((w - (n - 1) * px(8)) / n))
    local step = n > 1 and math.min((w - D) / (n - 1), px(84)) or 0
    local lh_ = px(3)
    local caps = o.caps ~= false
    local cap_h = caps and (lh1(11) + px(6)) or 0
    local height = D + px(8) + cap_h
    local cy = px(4) + D / 2
    local layers = {}
    for i = first, last - 1 do
        local done = books[i].status == "read" and books[i + 1].status == "read"
        local x = math.floor((i - first) * step + D / 2 + 0.5)
        table.insert(layers, { widget = BoardUI.rect(math.floor(step + 0.5), lh_, done and INK.black or INK.gc), x = x, y = math.floor(cy - lh_ / 2 + 0.5) })
    end
    local dp = BoardMetrics.get().dp
    for i = first, last do
        local b = books[i]
        local x = math.floor((i - first) * step + 0.5)
        local read = b.status == "read"
        local started = not read and ((b.pct or 0) > 0 or b.status == "reading" or b.status == "rereading")
        local ring = read and 0 or (started and math.max(2, px(2.5)) or math.max(1, px(1.25)))
        local child
        if read then
            child = icon("check", math.floor(D * 0.5), { col = "white", sw = 3 })
        else
            child = text(b.index or "?", { s = math.max(11, math.floor(D / dp * 0.42 + 0.5)), b = true, col = started and INK.black or INK.g5 })
        end
        local node = BoardUI.circle(D, { border = ring, border_col = started and INK.black or INK.g8, bg = read and INK.black or INK.white }, child)
        if b.current then
            local outer = px(5)
            local gap_ring = px(3)
            table.insert(layers, { widget = BoardUI.circle(D + 2 * outer, { bg = INK.black }, space(1, 1)), x = x - outer, y = px(4) - outer })
            table.insert(layers, { widget = BoardUI.circle(D + 2 * gap_ring, { bg = INK.white }, space(1, 1)), x = x - gap_ring, y = px(4) - gap_ring })
            table.insert(layers, { widget = node, x = x, y = px(4) })
        else
            table.insert(layers, { widget = region(node, { kind = "detail", book_id = b.id }, "series"), x = x, y = px(4) })
        end
        if caps and (b.current or (s.next and b.id == s.next.id)) then
            local cap = text(b.current and _("This book") or _("Next"), { s = 11, b = b.current, col = b.current and INK.black or INK.g4 })
            local cw = wOf(cap)
            table.insert(layers, { widget = cap, x = math.floor(clamp(x + D / 2 - cw / 2, 0, w - cw)), y = px(4) + D + px(8) })
        end
    end
    return BoardUI.overlay(w, height, layers)
end

local function seriesSummary(d, w, compact)
    local s = d.series
    local nxt = s.next
    local titles = {}
    for _i, b in ipairs(s.books) do table.insert(titles, b.title) end
    local next_t = nxt and nxt.index and T(_("Next: Book %1, %2"), nxt.index, DetailData.pagerTitle(nxt.title, titles) or "") or nil
    local lead = compact and T(_("%1: %2 of %3 read"), s.name, s.read, s.total) or T(_("%1 of %2 read"), s.read, s.total)
    local options = {}
    if next_t then table.insert(options, { lead, " · " .. next_t }) end
    if nxt and nxt.index then table.insert(options, { lead, " · " .. T(_("Next: Book %1"), nxt.index) }) end
    table.insert(options, { lead, nil })
    local pick = options[#options]
    for _i, o in ipairs(options) do
        if textWidth(o[1], { s = 13, b = true }) + (o[2] and textWidth(o[2], { s = 13 }) or 0) <= w then pick = o; break end
    end
    local parts = { { t = pick[1], b = true } }
    if pick[2] then table.insert(parts, { t = pick[2], col = INK.g3 }) end
    return runs(parts, { s = 13, w = w, data = true })
end

local function seriesBlock(d, w, compact)
    return vstack({ w = w }, { seriesPath(d.series, w, { caps = not compact, dia = compact and 30 or 34 }), space(nil, px(8)), seriesSummary(d, w, compact) })
end

-- ----------------------------------------------------------------- shelves
-- `count` covers filling the width, captioned or not.
local function shelf(books, w, count, captions, row_key)
    local gap0 = px(12)
    local cover_w = math.floor((w - (count - 1) * gap0) / count)
    local cover_h = math.floor(cover_w * 1.5 + 0.5)
    local gap = count > 1 and math.floor((w - count * cover_w) / (count - 1)) or 0
    local items = {}
    for i = 1, math.min(count, #books) do
        local b = books[i]
        local cover = BoardUI.cover(b, cover_w, cover_h, { path = b.cover_path, border = hair(), border_col = INK.gb, loading = b.cover_state == "loading" })
        local cell = cover
        if captions then
            local author = b.authors and b.authors[1] or ""
            cell = vstack({ w = cover_w }, { cover, space(nil, px(6)), text(b.title or "", { s = 12, b = true, w = cover_w, data = true }), text(author, { s = 11, col = INK.g4, w = cover_w, data = true }) })
        end
        table.insert(items, region(cell, { kind = "detail", book_id = b.id }, row_key or "shelf"))
    end
    return hstack({ gap = gap, valign = "top" }, items)
end

-- The shelf's heading: one label, or Similar books and More by <author> as
-- tabs, the chosen one inked and underlined. All opens the author's books.
local function shelfHead(d, w)
    local right
    if d.shelf.kind == "author" then
        right = region(hstack({ h = px(32), gap = px(2) }, { text(_("All"), { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) }),
            { kind = "author" }, "shelf-head", "shelf-all")
    end
    local right_w = right and (wOf(right) + px(12)) or 0
    local tabs = d.shelf_tabs or {}
    if #tabs < 2 then
        local left = text(d.shelf.label, { s = 14, b = true, w = w - right_w, data = true })
        return hstack({ w = w, h = right and px(32) or lh1(14) }, { left, flex(0), right or false })
    end
    local gap = px(20)
    local avail = w - right_w - gap * (#tabs - 1)
    local widths, total = {}, 0
    for i, tab in ipairs(tabs) do
        widths[i] = wOf(text(tab.label, { s = 14, b = true }))
        total = total + widths[i]
    end
    local items = {}
    for i, tab in ipairs(tabs) do
        local label = tab.label
        local lw = widths[i]
        -- A long author name gives way to "More by this author", then is cut.
        if total > avail and tab.short then
            local short_w = wOf(text(tab.short, { s = 14, b = true }))
            total = total - lw + short_w
            label, lw = tab.short, short_w
        end
        if total > avail then lw = math.max(px(40), lw - (total - avail)) end
        local on = tab.kind == d.shelf.kind
        -- A 32dp target; the label and its rule sit at the bottom, by the covers.
        local cell = vstack({ w = lw, h = px(32) }, {
            flex(0),
            text(label, { s = 14, b = true, col = on and INK.black or INK.g4, w = lw, data = true }),
            space(nil, px(4)),
            BoardUI.rect(lw, px(2), on and INK.black or INK.white),
        })
        table.insert(items, region(cell, { kind = "shelf-tab", value = tab.kind }, "shelf-head", "shelf-tab-" .. tab.kind))
        if i < #tabs then table.insert(items, space(gap, 1)) end
    end
    table.insert(items, flex(0))
    if right then table.insert(items, right) end
    return hstack({ w = w, h = px(32), valign = "bottom" }, items)
end

local function shelfCount(w)
    if w >= BoardMetrics.lpx(600) then return 6 end
    if w >= BoardMetrics.lpx(480) then return 5 end
    return 4
end

-- ------------------------------------------------------------ the fill
-- Required parts first, then optional ones by value while they fit, then
-- elastic parts grow (in phases) into what is left, then late parts take
-- any remainder. Every part reports its height for a size.
local function fill(avail, gap, parts)
    local chosen, in_chosen = {}, {}
    local function size0(p) return p.min end
    local used = 0
    -- Only the first required part stays whatever its size; the others
    -- step aside rather than run off the page.
    for _i, p in ipairs(parts) do
        if p.required then
            local ph = p.h(size0(p)) + (#chosen > 0 and gap or 0)
            if #chosen == 0 or used + ph <= avail then
                table.insert(chosen, p); in_chosen[p] = true
                used = used + ph
            end
        end
    end
    local optional = {}
    for _i, p in ipairs(parts) do if not p.required and not p.late then table.insert(optional, p) end end
    table.sort(optional, function(a, b) return (a.value or 0) > (b.value or 0) end)
    for _i, p in ipairs(optional) do
        local ph = p.h(size0(p))
        if used + gap + ph <= avail then table.insert(chosen, p); in_chosen[p] = true; used = used + gap + ph end
    end
    local sizes = {}
    for _i, p in ipairs(chosen) do sizes[p] = p.min end
    local phases = {}
    for _i, p in ipairs(chosen) do
        if p.grow then
            for _j, ph in ipairs(p.phases or { { to = p.max, gv = p.grow_value or 0 } }) do
                table.insert(phases, { p = p, to = ph.to, gv = ph.gv })
            end
        end
    end
    table.sort(phases, function(a, b) return a.gv > b.gv end)
    for _i, ph in ipairs(phases) do
        local p = ph.p
        local best = sizes[p]
        local steps = {}
        if p.steps then
            for _j, v in ipairs(p.steps) do if v > best and v <= ph.to then table.insert(steps, v) end end
        else
            local v = best + (p.step or 1)
            while v <= ph.to do table.insert(steps, v); v = v + (p.step or 1) end
        end
        for _j, v in ipairs(steps) do
            local delta = p.h(v) - p.h(best)
            if used + delta <= avail then used = used + delta; best = v else break end
        end
        sizes[p] = best
    end
    for _i, p in ipairs(parts) do
        if p.late and not in_chosen[p] then
            local ph = p.h(p.min)
            if used + gap + ph <= avail then table.insert(chosen, p); in_chosen[p] = true; sizes[p] = p.min; used = used + gap + ph end
        end
    end
    local order = {}
    for _i, p in ipairs(parts) do if in_chosen[p] then table.insert(order, p) end end
    return { order = order, sizes = sizes, used = used }
end
DetailView.fill = fill

-- Measures a part without keeping its regions.
local function measured(build)
    return function(v)
        local saved = build_ctx
        build_ctx = nil
        local widget = build(v)
        build_ctx = saved
        local h = hOf(widget)
        if widget.free then widget:free() end
        return h
    end
end

local function renderFill(f, gap, rule_between, w)
    local items = {}
    for i, p in ipairs(f.order) do
        if i > 1 then
            if rule_between then
                local top = math.floor(gap / 2)
                table.insert(items, space(nil, top))
                table.insert(items, rule(w))
                table.insert(items, space(nil, gap - top - hair()))
            else
                table.insert(items, space(nil, gap))
            end
        end
        table.insert(items, mark("part-" .. p.id, p.node(f.sizes[p])))
    end
    return items
end

-- ------------------------------------------------------- main page parts
local function mainParts(d, w, o)
    o = o or {}
    local parts = {}
    local head = function(label, right) return sectionHead(w, label, right, 14) end
    local excerpt = d.excerpt
    local total = excerpt and linesNeeded(excerpt, { s = 14 }, w) or 1
    -- The turned layout heads the description; the upright one does not.
    local head_h = o.about_head and (lh1(14) + px(8)) or 0
    local function about(n)
        local body
        if not excerpt then
            body = text(_("No description yet."), { s = 14, col = INK.g4, w = w })
        else
            local lines = math.min(n, total)
            body = region(text(excerpt, { s = 14, col = INK.g1, lines = lines > 1 and lines or nil, w = w, data = true }), { kind = "about" }, "about")
        end
        if not o.about_head then return body end
        return vstack({ w = w }, { head(_("About this book")), space(nil, px(8)), body })
    end
    -- The description's first six lines come before the shelf's captions;
    -- the rest of it only after them.
    table.insert(parts, { id = "about", required = true, grow = true, grow_value = 10,
        phases = { { to = math.min(total, math.max(6, o.about_min or 3)), gv = 10 }, { to = math.min(total, 30), gv = 7 } },
        min = math.min(total, o.about_min or 3), max = math.min(total, 30), node = about,
        h = function(v) return head_h + (excerpt and BoardMetrics.textBoxHeight(math.min(v, total), 14) or lh1(14)) end })
    local spec = specStrip(d, w) and function() return specStrip(d, w) end or nil
    if spec then table.insert(parts, { id = "spec", value = 90, node = spec, h = measured(spec), min = 0 }) end
    if #(d.chips or {}) > 0 then
        local function chips() return chipRows(d, w, 1) end
        table.insert(parts, { id = "chips", value = 45, node = chips, h = measured(chips), min = 0 })
    end
    if d.series then
        local function series(v)
            if v == 1 then
                return vstack({ w = w }, { head(d.series.name, T(_("All %1"), d.series.total)), space(nil, px(10)), seriesBlock(d, w, false) })
            end
            return seriesBlock(d, w, true)
        end
        table.insert(parts, { id = "series", value = 80, grow = true, grow_value = 6, min = 0, max = 1, step = 1, node = series, h = measured(series) })
    end
    if d.shelf then
        local count = shelfCount(w)
        local function shelf_part(v)
            return vstack({ w = w }, { shelfHead(d, w), space(nil, px(10)),
                shelf(d.shelf.books, w, v == 0 and math.min(6, count + 1) or count, v == 2) })
        end
        table.insert(parts, { id = "similar", required = true, value = 50, grow = true, min = count >= 6 and 1 or 0, max = 2, step = 1,
            phases = { { to = 1, gv = 20 }, { to = 2, gv = 8 } }, node = shelf_part, h = measured(shelf_part) })
    end
    -- Display order: facts, description, genres, series, shelf.
    local order = { spec = 1, about = 2, chips = 3, series = 4, similar = 5 }
    table.sort(parts, function(a, b) return order[a.id] < order[b.id] end)
    return parts
end

-- --------------------------------------------------- More details parts
local function ledger(rows, w, cols, row_h)
    local gap_x = px(24)
    local cw = math.floor((w - (cols - 1) * gap_x) / cols)
    local lab_w = math.floor(cw * 0.36 + 0.5)
    local per = math.ceil(#rows / cols)
    local columns = {}
    for k = 0, cols - 1 do
        local items = {}
        for i = k * per + 1, math.min(#rows, (k + 1) * per) do
            if i > k * per + 1 then table.insert(items, rule(cw)) end
            local h = px(row_h) - ((i > k * per + 1) and hair() or 0)
            table.insert(items, hstack({ w = cw, h = h, gap = px(10) }, {
                text(rows[i][1], { s = 13, col = INK.g4, w = lab_w }),
                text(rows[i][2], { s = 14, w = cw - lab_w - px(10), data = true }),
            }))
        end
        table.insert(columns, vstack({ w = cw }, items))
    end
    return hstack({ w = w, gap = gap_x, valign = "top" }, columns)
end

local function fileRow(entry, w, first, offline)
    local row_h = px(52)
    local right
    if entry.on_device then
        right = hstack({ gap = px(5) }, { icon("circle-check", px(17), { sw = 2.25 }), text(_("On device"), { s = 13, b = true }) })
    elseif offline then
        right = text(_("Needs Wi-Fi"), { s = 12, col = INK.g4 })
    else
        right = region(pill({ kind = "outline", icon = "download", label = _("Get"), h = px(34), s = 13, icon_size = 15, pad_r = 14, ring = 1.25 }),
            { kind = "get", file = entry.file }, "formats")
    end
    local rw = wOf(right)
    local tw = w - px(50) - rw - 2 * px(12)
    local subs = DetailData.fileSubs(entry)
    local sub = firstFitting(subs, { s = 12 }, math.max(1, tw))
    local chip = BoardUI.box({ w = math.max(px(50), textWidth(entry.format, { s = 12, b = true }) + 2 * px(7)), h = px(24), radius = px(5), border = math.max(1, px(1.25)), border_col = INK.black },
        hstack({ w = math.max(px(50), textWidth(entry.format, { s = 12, b = true }) + 2 * px(7)) - 2 * math.max(1, px(1.25)), h = px(24) - 2 * math.max(1, px(1.25)) }, { flex(0), text(entry.format, { s = 12, b = true }), flex(0) }))
    local body = hstack({ w = w, h = row_h - (first and 0 or hair()), gap = px(12) }, {
        hstack({ w = px(50) }, { chip, flex(0) }),
        vstack({ w = math.max(1, tw) }, { text(entry.title, { s = 14, b = true, w = math.max(1, tw) }), sub ~= "" and text(sub, { s = 12, col = INK.g4, w = math.max(1, tw) }) or nil }),
        right,
    })
    if first then return body end
    return vstack({ w = w }, { rule(w), body })
end

local function otherFilesRow(other, w, first)
    local row_h = px(52)
    local chips = {}
    for _i, entry in ipairs(other) do
        local cw = math.max(px(40), textWidth(entry.format, { s = 12, b = true }) + 2 * px(7))
        local b = math.max(1, px(1.25))
        table.insert(chips, BoardUI.box({ w = cw, h = px(24), radius = px(5), border = b, border_col = INK.g8 },
            hstack({ w = cw - 2 * b, h = px(24) - 2 * b }, { flex(0), text(entry.format, { s = 12, b = true, col = INK.g5 }), flex(0) })))
    end
    local chip_row = hstack({ gap = px(4) }, chips)
    local tw = w - wOf(chip_row) - px(12)
    local sub = firstFitting(DetailData.otherFilesSubs(other), { s = 12 }, tw)
    local body = hstack({ w = w, h = row_h - (first and 0 or hair()), gap = px(12) }, {
        chip_row,
        vstack({ w = tw }, { text(_("Also in BookOrbit"), { s = 14, b = true, col = INK.g3, w = tw }), text(sub, { s = 12, col = INK.g4, w = tw }) }),
    })
    if first then return body end
    return vstack({ w = w }, { rule(w), body })
end

-- The reading path: progress through the book by day since it was started,
-- a stepped area drawn from plain rectangles.
local PathChart = Widget:extend{ values = nil, pct = 0, started = nil }

function PathChart:getSize() return self.dimen end

function PathChart:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local w, h = self.dimen.w, self.dimen.h
    local axis_h = lh1(11) + px(4)
    local ch = h - axis_h
    local values = self.values
    local n = #values
    local edge = math.max(2, px(2))
    local top_pct = math.min(100, math.max(10, math.ceil(self.pct * 1.25 / 5) * 5))
    local function yOf(p) return math.floor(ch - (ch - lh1(12) - px(6)) * p / top_pct + 0.5) end
    bb:paintRect(x, y + ch, w, hair(), INK.g8)
    bb:paintRect(x, y + yOf(self.pct), w, hair(), INK.ge)
    local prev_top = ch
    for i = 1, n do
        local top = yOf(values[i])
        local x0 = math.floor((i - 1) * w / n + 0.5)
        local x1 = math.floor(i * w / n + 0.5)
        bb:paintRect(x + x0, y + top, x1 - x0, ch - top, INK.gd)
        bb:paintRect(x + x0, y + top - math.floor(edge / 2), x1 - x0, edge, INK.black)
        if top ~= prev_top then
            bb:paintRect(x + math.max(0, x0 - math.floor(edge / 2)), y + math.min(top, prev_top) - math.floor(edge / 2), edge, math.abs(top - prev_top) + edge, INK.black)
        end
        prev_top = top
    end
end

local function pathChart(j, pct, w, h)
    local axis = hstack({ w = w }, { text(j.started or "", { s = 11, col = INK.g4 }), flex(0), text(_("Today"), { s = 11, col = INK.g4 }) })
    local chart = PathChart:new{ dimen = Geom:new{ w = w, h = h }, values = j.path, pct = pct }
    local label = text(DetailData.pctLabel(pct) or "", { s = 12, b = true })
    local axis_h = lh1(11) + px(4)
    local ch = h - axis_h
    local top_pct = math.min(100, math.max(10, math.ceil(pct * 1.25 / 5) * 5))
    local y_pct = math.floor(ch - (ch - lh1(12) - px(6)) * pct / top_pct + 0.5)
    return BoardUI.overlay(w, h, {
        { widget = chart, x = 0, y = 0 },
        { widget = axis, x = 0, y = ch + px(4) },
        { widget = BoardUI.box({ w = wOf(label) + px(4), h = hOf(label), bg = INK.white }, hstack({}, { space(px(4), 1), label })), x = w - wOf(label) - px(4), y = math.max(0, y_pct - lh1(12) - px(5)) },
    })
end

local function stat(value, label, w)
    return vstack({ w = w }, { text(value or "", { s = 16, b = true, w = w, data = true }), text(label, { s = 12, col = INK.g4, w = w }) })
end

local function quote(hl, w, max_lines)
    local bar = px(3)
    local pad = px(14)
    local tw = w - bar - pad
    local body = vstack({ w = tw }, {
        text(hl.text or "", { s = 14, i = true, serif = true, lines = max_lines, w = tw, data = true }),
        space(nil, px(6)),
        runs({ { t = hl.chapter or "", b = true, col = INK.g2 }, { t = hl.when and (" · " .. hl.when) or "", col = INK.g4 } }, { s = 12, w = tw, data = true }),
    })
    return hstack({ w = w, valign = "top" }, { BoardUI.rect(bar, hOf(body), INK.black, math.floor(bar / 2)), space(pad, 1), body })
end

local function detailsParts(d, w, lw, rw, two_col)
    local parts = {}
    local wide = screenW() >= 600 or two_col
    local head = function(width, label, right) return sectionHead(width, label, right, 15) end
    -- About: one row to the full text; lines only with room to spare.
    local desc = d.description
    local total = desc and linesNeeded(desc, { s = 14 }, lw) or 0
    local function about(n)
        local body
        if not desc then
            body = text(_("No description yet."), { s = 14, col = INK.g4, w = lw })
        elseif n == 0 then
            body = region(hstack({ gap = px(6) }, { icon("file-text", px(16), { sw = 2.25 }), text(_("Read the full description"), { s = 14, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) }), { kind = "about" }, "details-about")
        else
            local items = { text(desc, { s = 14, lines = math.min(n, total) > 1 and math.min(n, total) or nil, w = lw, data = true }) }
            if n < total then
                table.insert(items, space(nil, px(6)))
                table.insert(items, region(hstack({ gap = px(2) }, { text(_("Read all"), { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) }), { kind = "about" }, "details-about"))
            end
            body = vstack({ w = lw }, items)
        end
        return vstack({ w = lw }, { head(lw, _("About this book")), space(nil, px(10)), body })
    end
    local steps = { 0 }
    if desc then for v = 3, math.min(total, 30) do table.insert(steps, v) end end
    table.insert(parts, { id = "about", col = "l", required = true, grow = true, grow_value = 10, min = 0, max = steps[#steps], steps = steps, node = about, h = measured(about) })
    -- Genres and tags sit under About; the description shortens to keep them,
    -- so they show at every interface size.
    if #(d.chips or {}) > 0 then
        local function chips_part(v) return vstack({ w = lw }, { head(lw, _("Genres and tags")), space(nil, px(10)), chipRows(d, lw, v or 2, "details-chips") }) end
        table.insert(parts, { id = "chips", col = "l", value = 40, min = 2, node = chips_part, h = measured(chips_part) })
    end
    -- Your reading: time on this device and highlights.
    local hl = d.highlights
    local j = d.journal
    if j or hl then
        local jw = two_col and rw or w
        local done = d.status == "read"
        local n4 = jw >= BoardMetrics.lpx(480) and 4 or 3
        local sw = math.floor((jw - (n4 - 1) * px(12)) / n4)
        local stats = {}
        if j then
            if done and j.finished_on then
                stats = { { j.finished_on, _("Finished") }, { j.time, _("Time read") }, { tostring(j.days), _("Reading days") }, { j.pace_short or "–", _("Pace") } }
            else
                stats = { { j.started, _("Started") }, { j.time, _("Time read") }, { tostring(j.days), _("Reading days") }, { j.last_read, _("Last read") } }
            end
        end
        local function one_line()
            local tail_opts = done and { T(_(" over %1 days, finished %2"), j.days, j.finished_on or ""), T(_(" over %1 days"), j.days) }
                or { T(_(" over %1 days since %2, last read %3"), j.days, j.started or "", j.last_read or ""), T(_(" over %1 days since %2"), j.days, j.started or ""), T(_(" over %1 days"), j.days) }
            local tail = tail_opts[#tail_opts]
            for _i, t in ipairs(tail_opts) do
                if textWidth(j.time, { s = 13, b = true }) + textWidth(t, { s = 13 }) <= jw then tail = t; break end
            end
            return runs({ { t = j.time, b = true }, { t = tail, col = INK.g3 } }, { s = 13, w = jw })
        end
        local chartable = j and d.progress and not done and j.path and #j.path > 0
        local right = hl and (hl.count == 1 and _("1 highlight") or T(_("%1 highlights"), hl.count)) or nil
        local function yours(v)
            local items = {}
            local h_ = sectionHead(jw, j and _("Your reading on this device") or _("Your highlights"), right, 15)
            if hl then h_ = region(h_, { kind = "highlights" }, "yours") end
            table.insert(items, h_)
            table.insert(items, space(nil, px(10)))
            if j then
                if v >= 2 then
                    local cells = {}
                    for i = 1, n4 do if stats[i] then table.insert(cells, stat(stats[i][1], stats[i][2], sw)) end end
                    table.insert(items, hstack({ w = jw, gap = px(12), valign = "top" }, cells))
                else
                    table.insert(items, one_line())
                end
            end
            if hl and (v >= 1 or not j) then
                if j then table.insert(items, space(nil, px(14))) end
                table.insert(items, quote(hl.latest, jw, 2))
            end
            if v >= 3 and chartable then
                table.insert(items, space(nil, px(14)))
                table.insert(items, pathChart(j, d.progress.pct, jw, px(110)))
            end
            return vstack({ w = jw }, items)
        end
        local max = not j and 0 or (chartable and 3 or 2)
        local steps_y = nil
        if not hl then steps_y = {} for _i, v in ipairs({ 0, 2, 3 }) do if v <= max then table.insert(steps_y, v) end end end
        table.insert(parts, { id = "yours", col = two_col and "r" or "l", required = true, grow = true, grow_value = 25, min = 0, max = max, step = 1, steps = steps_y, node = yours, h = measured(yours) })
    end
    local function ledger_part() return vstack({ w = rw }, { head(rw, _("Details")), space(nil, px(4)), ledger(d.facts, rw, (wide and not two_col) and 2 or 1, 32) }) end
    if #(d.facts or {}) > 0 then table.insert(parts, { id = "ledger", col = "r", required = true, node = ledger_part, h = measured(ledger_part), min = 0 }) end
    local function formats_part()
        local items = { head(rw, _("Formats")), space(nil, px(2)) }
        for i, entry in ipairs(d.usable) do table.insert(items, fileRow(entry, rw, i == 1, d.offline)) end
        if #d.other > 0 then table.insert(items, otherFilesRow(d.other, rw, #d.usable == 0)) end
        return vstack({ w = rw }, items)
    end
    if #d.usable + #d.other > 0 then table.insert(parts, { id = "formats", col = "r", required = true, node = formats_part, h = measured(formats_part), min = 0 }) end
    -- The author's other books, when the main page's shelf was Similar books.
    if d.author_books then
        local aw = two_col and lw or w
        local count = shelfCount(aw)
        local function author_part(v)
            return vstack({ w = aw }, { head(aw, T(_("More by %1"), d.author_first or "")), space(nil, px(10)), shelf(d.author_books, aw, count, v == 1, "author") })
        end
        table.insert(parts, { id = "author", col = "l", value = 30, grow = true, grow_value = 2, min = 0, max = 1, step = 1, node = author_part, h = measured(author_part) })
    end
    return parts
end

-- ---------------------------------------------------------------- pages
local function mainPage(d, w, body_h, m, full_h)
    if m.w > m.h then
        -- Turned: a spread. The left page is the cover box with the actions
        -- under it; the right page reads like the portrait column, then the
        -- rest. The box is sized as if the pager were showing, so it is the
        -- same on every book.
        local lw = math.floor(w * 0.36 + 0.5)
        local spine = px(44)
        local rw = w - lw - spine
        local actions = wideActions(d, lw)
        local room = math.min(body_h, full_h - px(48) - px(8)) - hOf(actions) - px(20)
        local box_w = math.min(lw, math.floor(room * 2 / 3))
        local box_h = math.floor(box_w * 1.5 + 0.5)
        local left = vstack({ w = lw, h = body_h }, {
            hstack({ w = lw }, { flex(0), region(coverBox(d, box_w, box_h), { kind = "cover" }, nil, "cover"), flex(0) }),
            flex(px(20)),
            actions,
        })
        local tf = BoardUI.fitTitle(d.title, { b = true }, rw, { 24, 22, 20, 18, 17 }, 3)
        local title_w = balancedWidth(d.title, { b = true, s = tf.s }, rw, tf.lines)
        local st = columnStanding(d, rw)
        local head = {}
        local k = kicker(d, rw)
        if k then table.insert(head, mark("kicker", k)); table.insert(head, space(nil, px(6))) end
        table.insert(head, mark("title", text(d.title, { s = tf.s, b = true, lines = tf.lines > 1 and tf.lines or nil, w = title_w, data = true })))
        if d.subtitle and tf.lines < 3 then
            table.insert(head, space(nil, px(2)))
            table.insert(head, text(d.subtitle, { s = 14, col = INK.g3, w = rw, data = true }))
        end
        table.insert(head, space(nil, px(4)))
        table.insert(head, mark("author", authorLine(d, rw, 16)))
        table.insert(head, space(nil, px(12)))
        table.insert(head, mark("verdict-row", verdictRow(d, rw)))
        if st then table.insert(head, space(nil, px(16))); table.insert(head, mark("standing", st)) end
        local head_block = vstack({ w = rw }, head)
        local gap = px(22)
        local f = fill(body_h - hOf(head_block) - gap, gap, mainParts(d, rw, { about_head = true }))
        local right = { head_block, space(nil, gap) }
        for _i, item in ipairs(renderFill(f, gap, true, rw)) do table.insert(right, item) end
        return hstack({ w = w, h = body_h, valign = "top" }, {
            left, space(math.floor(spine / 2), 1), BoardUI.rect(hair(), body_h, INK.gb), space(spine - math.floor(spine / 2) - hair(), 1),
            vstack({ w = rw, h = body_h }, right),
        })
    end
    local top = DetailView.jacket(d, w)
    local top_h = hOf(top) + px(20)
    local about_min = (d.series and d.shelf) and 2 or 3
    local f = fill(body_h - top_h, px(18), mainParts(d, w, { about_min = about_min }))
    local items = { top, space(nil, px(20)) }
    for _i, item in ipairs(renderFill(f, px(18), true, w)) do table.insert(items, item) end
    if DEBUG then
        local parts = {}
        for _i, p in ipairs(f.order) do table.insert(parts, p.id .. "=" .. tostring(f.sizes[p]) .. ":" .. p.h(f.sizes[p]) .. "/" .. hOf(p.node(f.sizes[p]))) end
        local real = 0
        for _i, item in ipairs(items) do if not (type(item) == "table" and item._flex) then real = real + hOf(item) end end
        require("logger").info("DETAILFIT body_h", body_h, "top_h", top_h, "used", f.used, "real", real, table.concat(parts, " "))
    end
    return vstack({ w = w, h = body_h }, items)
end

local function detailsPage(d, w, body_h, m)
    local gap = px(22)
    local two_col = m.w > m.h
    local lw = two_col and math.floor((w - px(40)) * 0.52) or w
    local rw = two_col and (w - lw - px(40)) or w
    local parts = detailsParts(d, w, lw, rw, two_col)
    if not two_col then
        local f = fill(body_h, gap, parts)
        return vstack({ w = w, h = body_h }, renderFill(f, gap, false, w))
    end
    local function side(which)
        local list = {}
        for _i, p in ipairs(parts) do if p.col == which or (which == "l" and p.col == "b") then table.insert(list, p) end end
        return list
    end
    local fl, fr = fill(body_h, gap, side("l")), fill(body_h, gap, side("r"))
    return hstack({ w = w, h = body_h, valign = "top", gap = px(40) }, {
        vstack({ w = lw }, renderFill(fl, gap, false, lw)),
        vstack({ w = rw }, renderFill(fr, gap, false, rw)),
    })
end

-- ------------------------------------------------------------- overlays
-- Lightens what is under a sheet, so the page stays visible behind it.
local Scrim = Widget:extend{}
function Scrim:getSize() return self.dimen end
function Scrim:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    bb:lightenRect(x, y, self.dimen.w, self.dimen.h, 0.55)
end

-- The verdict sheet: rating and status in one place.
local function verdictSheet(d, screen_w, screen_h, mx)
    local w = screen_w - 2 * mx
    local pad = px(18)
    local opts = {
        { id = "want_to_read", icon = "bookmark" }, { id = "reading", icon = "book-open" }, { id = "on_hold", icon = "circle-pause" },
        { id = "read", icon = "book-check" }, { id = "abandoned", icon = "x" }, { id = "unread", icon = "rotate-ccw" },
    }
    local two = screenW() >= 600
    local opt_h = px(52)
    local cw = two and math.floor((w - px(10)) / 2) or w
    local star_d = px(44)
    local stars = {}
    for i = 1, 5 do
        local on = i <= (d.rating or 0)
        table.insert(stars, region(hstack({ w = star_d, h = star_d }, { flex(0), icon("star", px(34), { sw = 1.75, col = on and "black" or "g8", fill = on }), flex(0) }), { kind = "rate", value = i, from_sheet = true }, "sheet-stars"))
    end
    local clear = d.rating and d.rating > 0 and region(text(_("Clear"), { s = 14, b = true }), { kind = "rate", value = nil, from_sheet = true }, "sheet-stars") or text(_("Tap a star"), { s = 13, col = INK.g4 })
    local star_row = hstack({ w = w, gap = px(6) }, { hstack({ gap = px(6) }, stars), flex(0), clear })
    local cells = {}
    for _i, o in ipairs(opts) do
        local on = o.id == d.status or (o.id == "reading" and d.status == "rereading")
        local label = DetailData.statusLabel(o.id)
        local inner = hstack({ w = cw - 2 * px(14), h = opt_h, gap = px(12) }, {
            icon(o.icon, px(19), { sw = 2.25, col = on and "white" or "black" }),
            text(label, { s = 15, b = true, col = on and INK.white or INK.black }),
            flex(0),
            on and icon("check", px(18), { sw = 2.75, col = "white" }) or nil,
        })
        local cell = BoardUI.box({ w = cw, h = opt_h, radius = px(12), border = on and 0 or line1(), border_col = INK.g8, bg = on and INK.black or INK.white },
            hstack({ w = cw - 2 * (on and 0 or line1()), h = opt_h - 2 * (on and 0 or line1()) }, { space(px(14) - (on and 0 or line1()), 1), inner }))
        table.insert(cells, region(cell, { kind = "status", value = o.id }, "sheet-status-" .. math.ceil(_i / (two and 2 or 1))))
    end
    local grid = {}
    local per = two and 2 or 1
    for k = 1, #cells, per do
        local row = {}
        for j = k, math.min(#cells, k + per - 1) do table.insert(row, cells[j]) end
        if k > 1 then table.insert(grid, space(nil, px(8))) end
        table.insert(grid, hstack({ gap = px(10) }, row))
    end
    local close = region(BoardUI.circle(px(40), { border = math.max(1, px(1.5)), bg = INK.white }, icon("x", px(20), { sw = 2.5 })), { kind = "close-sheet" }, "sheet-head")
    local head_row = hstack({ w = w, valign = "top" }, {
        vstack({ w = w - px(56) }, { text(_("Your verdict"), { s = 20, b = true }), text(d.title, { s = 13, col = INK.g4, w = w - px(56), data = true }) }),
        flex(0), close,
    })
    local body = vstack({ w = w }, {
        head_row, space(nil, px(14)),
        text(_("Rating"), { s = 13, b = true, col = INK.g4 }), space(nil, px(10)), star_row,
        space(nil, px(22)),
        text(_("Status"), { s = 13, b = true, col = INK.g4 }), space(nil, px(10)),
        vstack({ w = w }, grid),
    })
    local sheet_h = math.min(screen_h - px(60), pad + hOf(body) + px(24))
    -- Rounded on top only: the box runs a radius past the screen's bottom
    -- edge, which clips it. A black box one rule taller behind it draws the
    -- top edge along the curve.
    local r = px(18)
    local edge = math.max(1, px(2))
    local sheet = BoardUI.box({ w = screen_w, h = sheet_h + r, radius = r, bg = INK.white },
        vstack({ w = screen_w, h = sheet_h + r, pad = { pad, mx, 0, mx } }, { body }))
    local backing = BoardUI.box({ w = screen_w, h = sheet_h + r + edge, radius = r, bg = INK.black }, space(1, 1))
    return { widget = sheet, backing = backing, edge = edge, h = sheet_h }
end

-- The ⋯ menu, anchored under the header's menu button: a white panel with a
-- black edge and a hard shadow below, rows of icon and label.
local function menuPanel(screen_w, mx, items)
    local mw = math.min(px(300), screen_w - 2 * mx)
    local ih = px(50)
    local b = math.max(1, px(1.5))
    local iw = mw - 2 * b
    local rows = {}
    for i, item in ipairs(items) do
        local sep = item.separator and i > 1
        local content_h = ih - (sep and hair() or 0)
        local row = hstack({ w = iw, h = content_h }, {
            space(px(16) - b, 1),
            icon(item.icon, px(19), { sw = 2.25 }),
            space(px(14), 1),
            text(item.label, { s = 15, w = mw - px(16 + 14 + 19 + 16), data = true }),
            flex(0),
        })
        if sep then row = vstack({ w = iw }, { BoardUI.rect(iw, hair(), INK.gc), row }) end
        table.insert(rows, region(row, item.action, "menu-" .. i))
    end
    local body = vstack({ w = iw }, { space(nil, px(6) - b), vstack({ w = iw }, rows), space(nil, px(6) - b) })
    local panel_h = hOf(body) + 2 * b
    local panel = BoardUI.box({ w = mw, h = panel_h, radius = px(14), border = b, border_col = INK.black, bg = INK.white }, body)
    local shadow = BoardUI.box({ w = mw, h = panel_h, radius = px(14), bg = INK.black }, space(1, 1))
    return BoardUI.overlay(mw, panel_h + px(3), { { widget = shadow, x = 0, y = px(3) }, { widget = panel, x = 0, y = 0 } }), mw
end

-- ------------------------------------------------------------- the screen
-- ctx: d (view model), page (1 main, 2 details), sheet ("verdict", "menu"),
-- menu_items, run (action handler), screen_w, screen_h.
-- Returns the screen widget, the focus rows (top to bottom) and the
-- regions by key.
function DetailView.build(ctx)
    BoardMetrics.refresh()
    local m = BoardMetrics.get()
    local d = ctx.d
    local screen_w, screen_h = ctx.screen_w, ctx.screen_h
    local W = math.floor(screen_w / m.layout_dp * 1000 + 0.5) / 1000
    local mx = px(W >= 900 and 28 or W >= 700 and 24 or W >= 560 and 20 or 16)
    local w = screen_w - 2 * mx
    local top = px(6)
    build_ctx = { rows = {}, row_order = {}, row_list = {}, regions = {}, run = ctx.run }
    local ok, result = pcall(function()
        local page = ctx.page == 2 and 2 or 1
        local header = DetailView.header(d, w, page == 2 and { back = _("Book"), center = _("More details") } or nil)
        local pager = page == 1 and DetailView.pager(d, w) or nil
        local off_h = d.offline and (px(32) + px(10)) or 0
        local pager_h = pager and (px(48) + px(8)) or 0
        local body_h = screen_h - top - px(48) - px(10) - off_h - pager_h - px(8)
        local metrics = { w = screen_w, h = screen_h, W = W, H = screen_h / m.dp, dp = m.dp }
        local body = page == 1 and mainPage(d, w, body_h, metrics, body_h + off_h + pager_h) or detailsPage(d, w, body_h, metrics)
        local items = {
            BoardUI.overlay(w, px(48), { { widget = header, x = -px(8), y = 0 } }),
            space(nil, px(10)),
        }
        if d.offline then table.insert(items, DetailView.offlineNotice(d, w)); table.insert(items, space(nil, px(10))) end
        table.insert(items, body)
        table.insert(items, flex(px(8)))
        if pager then table.insert(items, mark("pager", pager)) end
        local screen = vstack({ w = screen_w, h = screen_h, pad = { top, mx, px(4), mx } }, items)
        -- The header's tap areas reach px(8) into the left margin.
        local layers = { { widget = screen, x = 0, y = 0 } }
        -- With a sheet or the menu open, a tap anywhere outside it closes it
        -- and reaches nothing underneath.
        if ctx.sheet then
            table.insert(layers, { widget = region(space(screen_w, screen_h), { kind = "close-sheet" }), x = 0, y = 0 })
        end
        if ctx.sheet == "verdict" then
            local sh = verdictSheet(d, screen_w, screen_h, mx)
            table.insert(layers, { widget = Scrim:new{ dimen = Geom:new{ w = screen_w, h = screen_h } }, x = 0, y = 0 })
            table.insert(layers, { widget = sh.backing, x = 0, y = screen_h - sh.h - sh.edge })
            table.insert(layers, { widget = sh.widget, x = 0, y = screen_h - sh.h })
        elseif ctx.sheet == "menu" then
            local panel, mw = menuPanel(screen_w, mx, ctx.menu_items or {})
            table.insert(layers, { widget = panel, x = screen_w - mx - mw, y = top + px(48) })
        end
        return BoardUI.overlay(screen_w, screen_h, layers)
    end)
    local out = build_ctx
    build_ctx = nil
    if not ok then error(result, 0) end
    local rows = {}
    for _i, key in ipairs(out.row_list) do
        local list = out.rows[key]
        if list and #list > 0 then
            list.id = key
            table.insert(rows, list)
        end
    end
    return result, rows, out.regions
end

return DetailView
