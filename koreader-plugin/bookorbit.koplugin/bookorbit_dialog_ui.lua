--[[--
Parts for BookOrbit's own dialogs: the sheets that replace KOReader's button
dialogs, confirm boxes and text viewers over BookOrbit pages.

A sheet is a MenuPage with the screen underneath kept as a lightened
backdrop, laid out by ListView.sheet: a full-width sheet from the bottom edge
below 760dp, a bordered popover above it. Every part is built from MenuUI and
BoardUI, so a dialog speaks the same language as the page it opens over.
]]

local Geom = require("ui/geometry")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space, flex, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space, BoardUI.flex, BoardUI.icon

local DialogUI = {}

local function wOf(widget) return widget:getSize().w end
local function hOf(widget) return widget:getSize().h end

-- A bottom sheet (popover when wide) holding build(inner_w, max_body_h)'s
-- items. Sets page.panel_rect so taps outside close it.
function DialogUI.sheet(page, sw, sh, build, o)
    o = o or {}
    local ListView = require("bookorbit_list_view")
    local layers, rect = ListView.sheet(sw, sh, { build = build, pop_w = o.pop_w or 460 })
    page.panel_rect = Geom:new{ x = rect.x, y = rect.y, w = rect.w, h = rect.h }
    return BoardUI.overlay(sw, sh, layers)
end

-- A sheet hung from the top edge (a centred popover when wide), for panels
-- that type: KOReader's keyboard takes the bottom. limit is the y the panel
-- must end above.
function DialogUI.topSheet(page, sw, sh, build, o)
    o = o or {}
    local mx = MenuUI.mx()
    local pad = px(16)
    local wide = BoardMetrics.get().W >= 760
    local pw = wide and math.min(px(o.pop_w or 560), sw - 2 * mx) or sw
    local pad_x = wide and pad or mx
    local inner = pw - 2 * pad_x
    local items = build(inner, (o.limit or sh) - 2 * pad)
    local spaced = {}
    for _i, item in ipairs(items) do
        if item then
            if #spaced > 0 then table.insert(spaced, space(nil, px(14))) end
            table.insert(spaced, item)
        end
    end
    local body = vstack({ w = inner }, spaced)
    local line = math.max(1, px(1.5))
    local r = px(16)
    local layers, x, y, ph
    if wide then
        ph = hOf(body) + 2 * pad
        local content = vstack({ w = pw - 2 * line, pad = { pad - line, pad - line, pad - line, pad - line } }, { body })
        x, y = math.floor((sw - pw) / 2), px(16)
        layers = { { widget = BoardUI.box({ w = pw, h = ph, radius = r, border = line, border_col = INK.black, bg = INK.white }, content), x = x, y = y } }
    else
        local pad_t = px(10)
        ph = pad_t + hOf(body) + pad
        local content = vstack({ w = pw, pad = { pad_t, pad_x, pad, pad_x } }, { body })
        x, y = 0, 0
        -- Square at the top edge, rounded at the bottom with a black rule along it.
        layers = {
            { widget = BoardUI.rect(pw, ph + line, INK.black, r), x = 0, y = 0 },
            { widget = BoardUI.rect(pw, r, INK.black), x = 0, y = 0 },
            { widget = BoardUI.rect(pw, ph, INK.white, r), x = 0, y = 0 },
            { widget = BoardUI.rect(pw, r, INK.white), x = 0, y = 0 },
            { widget = content, x = 0, y = 0 },
        }
    end
    page.panel_rect = Geom:new{ x = x, y = y, w = pw, h = ph }
    return BoardUI.overlay(sw, sh, layers), page.panel_rect
end

-- Opens a sheet over whatever is on screen. opts as for MenuPage; build is
-- function(page, sw, sh).
function DialogUI.open(opts)
    opts.backdrop = opts.backdrop ~= false
    if opts.dismiss_outside == nil then opts.dismiss_outside = true end
    local page = MenuPage:new(opts)
    UIManager:show(page, "ui")
    return page
end

-- The close button, its glyph on the panel's padding edge.
function DialogUI.closeButton(action)
    return MenuUI.iconButton("x", action or { kind = "close" })
end

-- A sheet's title row: a title, an optional muted line, and close.
function DialogUI.titleRow(w, title, sub, o)
    o = o or {}
    local inset = MenuUI.tapInset(23)
    local close = o.close ~= false and DialogUI.closeButton() or nil
    local tw = w - (close and (wOf(close) - inset + px(8)) or 0)
    local column = vstack({ w = tw }, {
        text(title, { s = 18, b = true, w = tw }),
        sub and text(sub, { s = 13, col = INK.g4, w = tw, data = true }) or false,
    })
    if not close then return column end
    local h = math.max(hOf(column), wOf(close) - 2 * inset)
    return BoardUI.overlay(w, h, {
        { widget = column, x = 0, y = 0 },
        { widget = close, x = w - wOf(close) + inset, y = -inset },
    })
end

-- A book's head: cover, title, author, chips and close. o: cover_path,
-- chips (widgets), close (false hides it), cover_w, cover_h.
function DialogUI.bookHead(w, book, o)
    o = o or {}
    local cw, ch = px(o.cover_w or 52), px(o.cover_h or 78)
    local inset = MenuUI.tapInset(23)
    local close = o.close ~= false and DialogUI.closeButton() or nil
    local tw = w - cw - px(14) - (close and (px(14) + wOf(close) - inset) or 0)
    local items = {
        text(book.title or "", { s = 18, b = true, w = tw, data = true }),
    }
    if book.author and book.author ~= "" then
        table.insert(items, text(book.author, { s = 13, col = INK.g4, w = tw, data = true }))
    end
    local chips = {}
    for _i, chip in ipairs(o.chips or {}) do if chip then table.insert(chips, chip) end end
    if #chips > 0 then
        table.insert(items, space(nil, px(6)))
        table.insert(items, DialogUI.wrap(tw, chips, px(6)))
    end
    local column = vstack({ w = tw }, items)
    local cover = BoardUI.cover({ title = book.title }, cw, ch, { path = o.cover_path, border = math.max(1, px(1)), border_col = INK.g6, valign = "top" })
    local h = math.max(ch, hOf(column))
    local row = hstack({ w = w - (close and (px(14) + wOf(close) - inset) or 0), h = h, gap = px(14), valign = "top" }, { cover, column })
    if not close then return row end
    return BoardUI.overlay(w, h, {
        { widget = row, x = 0, y = 0 },
        { widget = close, x = w - wOf(close) + inset, y = -inset },
    })
end

-- Widgets left to right, wrapping onto new lines, gap between both ways.
function DialogUI.wrap(w, widgets, gap)
    gap = gap or px(8)
    local lines, line, used = {}, {}, 0
    for _i, widget in ipairs(widgets) do
        local ww = wOf(widget)
        if #line > 0 and used + gap + ww > w then
            table.insert(lines, line)
            line, used = {}, 0
        end
        if #line > 0 then used = used + gap end
        table.insert(line, widget)
        used = used + ww
    end
    if #line > 0 then table.insert(lines, line) end
    local rows = {}
    for index, items in ipairs(lines) do
        if index > 1 then table.insert(rows, space(nil, gap)) end
        local row = {}
        for _i, item in ipairs(items) do table.insert(row, item) end
        table.insert(row, flex(0))
        table.insert(rows, hstack({ w = w, gap = gap, valign = "center" }, row))
    end
    return vstack({ w = w }, rows)
end

-- An outlined chip for a label that is not a button (genres, tags).
function DialogUI.labelChip(label, max_w)
    local h = px(34)
    local b = math.max(1, px(1))
    local t = text(label, { s = 14, data = true })
    if max_w and wOf(t) > max_w - 2 * px(14) then t = text(label, { s = 14, data = true, w = max_w - 2 * px(14) }) end
    local w = wOf(t) + 2 * px(14)
    return BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), border = b, border_col = INK.g8, bg = INK.white },
        hstack({ w = w - 2 * b, h = h - 2 * b }, { flex(0), t, flex(0) }))
end

-- Pills sharing the width equally. pills: { label, icon, kind, action }.
function DialogUI.pillRow(w, pills)
    local gap = px(10)
    local n = #pills
    local each = math.floor((w - gap * (n - 1)) / n)
    local items = {}
    for index, p in ipairs(pills) do
        local pw = index == n and (w - (each + gap) * (n - 1)) or each
        table.insert(items, MenuUI.pill(p.label, { icon = p.icon, kind = p.kind, w = pw, action = p.action }))
    end
    return hstack({ w = w, gap = gap }, items)
end

-- A short line under buttons: an icon and a few words.
function DialogUI.note(w, glyph, str, o)
    o = o or {}
    return hstack({ w = w, gap = px(8), valign = "top" }, {
        icon(glyph, px(16), { sw = 2.25, col = o.icon_col or "black" }),
        text(str, { s = 13, b = o.b, col = o.col or INK.g3, w = w - px(24), lines = o.lines or 2, data = o.data }),
    })
end

-- A boxed warning: gray fill, words first.
function DialogUI.warn(w, title, body)
    local pad = px(12)
    local iw = w - 2 * pad - px(22) - px(10)
    local column = vstack({ w = iw }, {
        text(title, { s = 14, b = true, w = iw, lines = 2, bg = INK.ge }),
        body and text(body, { s = 13, col = INK.g3, w = iw, lines = 4, bg = INK.ge }) or false,
    })
    local inner = hstack({ w = w - 2 * pad, gap = px(10), valign = "top" }, { icon("triangle-alert", px(22), { sw = 2 }), column })
    local h = hOf(inner) + 2 * pad
    return BoardUI.box({ w = w, h = h, radius = px(10), bg = INK.ge }, vstack({ w = w, pad = pad }, { inner }))
end

-- A section label over a body.
function DialogUI.section(w, title, body, right)
    return vstack({ w = w }, { MenuUI.label(w, title, right), space(nil, px(8)), body })
end

-- Text at width w on as many lines as it needs, up to max_lines.
function DialogUI.lines(str, o, w, max_lines)
    local single = text(str, o)
    if wOf(single) <= w then
        single:free()
        return text(str, { s = o.s, b = o.b, col = o.col, w = w, data = o.data })
    end
    single:free()
    local TextBoxWidget = require("ui/widget/textboxwidget")
    local probe = TextBoxWidget:new{ text = str, face = BoardMetrics.face(o.s), bold = o.b, width = w }
    local n = math.max(1, math.min(max_lines or 4, math.floor(probe:getSize().h / BoardMetrics.lh(o.s) + 0.5)))
    probe:free()
    return text(str, { s = o.s, b = o.b, col = o.col, w = w, lines = n, data = o.data })
end

-- A question before something that cannot be taken back: what happens, in a
-- title and a line or two, then Cancel and the action named by its verb.
-- o: title, text, ok_label, ok_icon, cancel_label, on_ok, on_cancel. Tapping
-- outside, Back and Cancel all cancel.
function DialogUI.confirm(o)
    local build = function(page, sw, sh)
        return DialogUI.sheet(page, sw, sh, function(w)
            local items = { DialogUI.lines(o.title, { s = 18, b = true }, w, 3) }
            if o.text then
                table.insert(items, DialogUI.lines(o.text, { s = 14, col = INK.g3 }, w, 5))
            end
            table.insert(items, DialogUI.pillRow(w, {
                { label = o.cancel_label or _("Cancel"), kind = "outline", action = { kind = "close" } },
                { label = o.ok_label, icon = o.ok_icon, action = { kind = "ok" } },
            }))
            return items
        end, { pop_w = 420 })
    end
    return DialogUI.open{
        name = "bookorbit_confirm",
        build = build,
        on_action = function(page, action)
            if action.kind == "ok" then
                page.confirmed = true
                page:close()
                if o.on_ok then UIManager:tickAfterNext(o.on_ok) end
            end
            return true
        end,
        on_close = function(page)
            if not page.confirmed and o.on_cancel then o.on_cancel() end
        end,
    }
end

-- One choice from a short list, as radio rows. o: title, sub, options
-- ({ label, sub, selected }), on_pick(index). Picking closes the sheet.
function DialogUI.choose(o)
    local build = function(page, sw, sh)
        return DialogUI.sheet(page, sw, sh, function(w)
            local iw = MenuUI.rowsIn(w)
            local rows = {}
            for index, opt in ipairs(o.options) do
                table.insert(rows, MenuUI.row(iw, { label = opt.label, sub = opt.sub, radio = opt.selected == true, action = { kind = "pick", index = index } }))
            end
            return { DialogUI.titleRow(w, o.title, o.sub), MenuUI.group(w, rows) }
        end, { pop_w = 420 })
    end
    return DialogUI.open{
        name = "bookorbit_choose",
        build = build,
        on_action = function(page, action)
            if action.kind == "pick" then
                page:close()
                UIManager:tickAfterNext(function() o.on_pick(action.index) end)
            end
            return true
        end,
    }
end

-- A short menu of things to do, as rows. o: title, sub, rows ({ icon,
-- label, sub, run, opens, disabled }). A row closes the sheet, then runs;
-- opens marks one that leads to another page, with a chevron.
function DialogUI.actions(o)
    local build = function(page, sw, sh)
        return DialogUI.sheet(page, sw, sh, function(w)
            local iw = MenuUI.rowsIn(w)
            local rows = {}
            for index, r in ipairs(o.rows) do
                if r then
                    table.insert(rows, MenuUI.row(iw, { icon = r.icon, label = r.label, sub = r.sub, chevron = r.opens and not r.disabled,
                        action = r.disabled and { kind = "noop" } or { kind = "run", index = index } }))
                end
            end
            return { DialogUI.titleRow(w, o.title, o.sub), MenuUI.group(w, rows) }
        end, { pop_w = 420 })
    end
    return DialogUI.open{
        name = "bookorbit_actions",
        build = build,
        on_action = function(page, action)
            if action.kind == "run" then
                local r = o.rows[action.index]
                page:close()
                if r and r.run then UIManager:tickAfterNext(r.run) end
            end
            return true
        end,
    }
end

DialogUI.pct = function(value)
    if not value then return nil end
    local n = value * 100
    if n > 0 and n < 0.5 then return "<1%" end
    if n < 100 and n >= 99.5 then return "99%" end
    return tostring(math.floor(n + 0.5)) .. "%"
end


return DialogUI
