--[[--
Parts for BookOrbit's own menus and settings pages, built on the dashboard's
drawing primitives so they share its type, grays and density step.

Every part is sized in dp through BoardMetrics.px. Tappable parts are wrapped
with BoardUI.hit and carry an action table; the page that builds them routes
taps and D-pad presses to its own action handler.
]]

local DataStorage = require("datastorage")
local IconWidget = require("ui/widget/iconwidget")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")

local INK = BoardMetrics.INK
local px, lh1 = BoardMetrics.px, BoardMetrics.lh1
local text, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local MenuUI = {}

-- Page margins step with width, like the board's.
function MenuUI.mx()
    local W = BoardMetrics.get().W
    return px(W >= 900 and 28 or W >= 700 and 24 or W >= 560 and 20 or 16)
end

function MenuUI.wide()
    return BoardMetrics.get().W >= 760
end

function MenuUI.landscape()
    local m = BoardMetrics.get()
    return m.w > m.h
end

function MenuUI.hair()
    return math.max(1, math.floor(BoardMetrics.get().dp * 0.75 + 0.5))
end

function MenuUI.line()
    return math.max(1, px(1))
end

MenuUI.CARD_PAD = 16

-- The inner width of a card's rows.
function MenuUI.rowsIn(w)
    return w - 2 * px(MenuUI.CARD_PAD)
end

-- An outline card around children laid out top to bottom. o: fill (gray
-- surface, no border), strong (black border), pad (horizontal, dp), vpad.
function MenuUI.card(w, children, o)
    o = o or {}
    local border = o.fill and 0 or MenuUI.line()
    local pad = px(o.pad or MenuUI.CARD_PAD)
    local vpad = px(o.vpad or 0)
    local inner = vstack({ w = w - 2 * border, pad = { vpad, pad - border, vpad, pad - border } }, children)
    local h = inner:getSize().h + 2 * border
    return BoardUI.box({
        w = w, h = h, border = border, radius = px(12),
        border_col = o.strong and INK.black or INK.g8,
        bg = o.fill and INK.ge or INK.white,
    }, inner)
end

-- A hairline between rows, starting past the icon column unless inset is 0.
function MenuUI.divider(w, inset)
    inset = inset or px(38)
    return hstack({ w = w, h = MenuUI.hair() }, { space(inset, 1), BoardUI.rect(w - inset, MenuUI.hair(), INK.gb) })
end

-- A card of rows with hairlines between them.
function MenuUI.group(w, rows, o)
    o = o or {}
    local iw = MenuUI.rowsIn(w)
    local children = {}
    for _i, r in ipairs(rows) do
        if r then
            if #children > 0 then table.insert(children, MenuUI.divider(iw, (o.inset == nil and r._no_icon) and 0 or o.inset)) end
            table.insert(children, r)
        end
    end
    return MenuUI.card(w, children, o)
end

function MenuUI.label(w, str, right)
    local l = text(str, { s = 13, b = true })
    if right then return BoardUI.spread(w, l, right) end
    return hstack({ w = w }, { l, flex(0) })
end

-- A section: its label, then the body.
function MenuUI.section(w, title, body)
    if not title then return body end
    return vstack({ w = w }, { MenuUI.label(w, title), space(nil, px(8)), body })
end

-- ------------------------------------------------------------- controls
function MenuUI.toggle(on)
    local w, h, k, pad = px(48), px(28), px(20), px(4)
    local b = math.max(1, px(1.5))
    local track = on and BoardUI.rect(w, h, INK.black, math.floor(h / 2))
        or BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), border = b, border_col = INK.g5, bg = INK.white })
    local knob = BoardUI.rect(k, k, on and INK.white or INK.g5, math.floor(k / 2))
    return BoardUI.overlay(w, h, {
        { widget = track },
        { widget = knob, x = on and (w - pad - k) or pad, y = pad },
    })
end

function MenuUI.radio(on)
    local s = px(22)
    return BoardUI.circle(s, { border = math.max(1, px(1.75)), bg = INK.white },
        on and BoardUI.rect(px(10), px(10), INK.black, px(5)) or space(1, 1))
end

function MenuUI.check()
    return BoardUI.circle(px(24), { bg = INK.black }, icon("check", px(15), { col = "white", sw = 3 }))
end

-- A segmented control: one outlined box, the chosen segment inked.
function MenuUI.segmented(w, options, selected, action_for)
    local h = px(40)
    local b = math.max(1, px(1.5))
    local n = #options
    local inner = w - 2 * b
    local seg_w = math.floor(inner / n)
    local segs = {}
    for index, label in ipairs(options) do
        local sw = index == n and (inner - seg_w * (n - 1)) or seg_w
        local on = index == selected
        local t = text(label, { s = 14, b = on, col = on and INK.white or INK.black, w = sw - px(8), align = "center" })
        local body = hstack({ w = sw, h = h - 2 * b }, { flex(0), t, flex(0) })
        local seg
        if on then
            seg = BoardUI.box({ w = sw, h = h - 2 * b, radius = px(8), bg = INK.black }, body)
        else
            local left_line = index > 1 and selected ~= index - 1
            seg = BoardUI.overlay(sw, h - 2 * b, {
                { widget = body },
                left_line and { widget = BoardUI.rect(MenuUI.hair(), h - 2 * b, INK.g8) } or {},
            })
        end
        table.insert(segs, action_for and BoardUI.hit(seg, action_for(index)) or seg)
    end
    return BoardUI.box({ w = w, h = h, radius = px(10), border = b, border_col = INK.black, bg = INK.white },
        hstack({ w = inner, h = h - 2 * b }, segs))
end

function MenuUI.stepper(value, unit, action_minus, action_plus)
    local s = px(36)
    local function btn(name, action)
        local c = BoardUI.circle(s, { border = math.max(1, px(1.5)), bg = INK.white }, icon(name, px(16), { sw = 2.75 }))
        return action and BoardUI.hit(c, action) or c
    end
    local mid = vstack({ w = px(52), align = "center" }, {
        text(tostring(value), { s = 18, b = true }),
        unit and text(unit, { s = 12, col = INK.g4 }) or false,
    })
    return hstack({ gap = px(10) }, { btn("minus", action_minus), mid, btn("plus", action_plus) })
end

-- A pill button. o: kind ("dark", "outline", "ghost"), icon, s, h, pad_x,
-- w (fixed width), action.
function MenuUI.pill(label, o)
    o = o or {}
    local h = px(o.h or 44)
    local dark = o.kind ~= "outline" and o.kind ~= "ghost"
    local fg = dark and INK.white or INK.black
    local t = text(label, { s = o.s or 15, b = true, col = fg, w = o.w and (o.w - 2 * px(o.pad_x or 18) - (o.icon and px(o.icon_size or 18) + px(8) or 0)) or nil, align = o.w and "center" or nil })
    local items = {}
    if o.icon then
        table.insert(items, icon(o.icon, px(o.icon_size or 18), { col = dark and "white" or "black", sw = 2.5 }))
    end
    table.insert(items, t)
    local content = hstack({ gap = px(8) }, items)
    local w = o.w or (content:getSize().w + 2 * px(o.pad_x or 18))
    local border = o.kind == "outline" and math.max(1, px(1.5)) or 0
    local body = hstack({ w = w - 2 * border, h = h - 2 * border }, { flex(0), content, flex(0) })
    local pill = BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), border = border, border_col = INK.black, bg = dark and INK.black or INK.white }, body)
    return o.action and BoardUI.hit(pill, o.action) or pill
end

-- A small status chip. Words and an icon, never shade alone.
function MenuUI.chip(label, o)
    o = o or {}
    local h = px(o.h or 26)
    local items = {}
    if o.icon then table.insert(items, icon(o.icon, px(14), { sw = 2.5, col = o.ink and "white" or "black" })) end
    table.insert(items, text(label, { s = 12, b = true, col = o.ink and INK.white or INK.black }))
    local content = hstack({ gap = px(5) }, items)
    local w = content:getSize().w + px(o.icon and 7 or 10) + px(10)
    return BoardUI.box({ w = w, h = h, radius = math.floor(h / 2), bg = o.ink and INK.black or INK.ge },
        hstack({ w = w, h = h }, { space(px(o.icon and 7 or 10), 1), content, flex(0) }))
end

function MenuUI.iconButton(name, action, o)
    o = o or {}
    local box = px(44)
    local b = hstack({ w = box, h = box }, { flex(0), icon(name, px(o.size or 23), { sw = o.sw or 2 }), flex(0) })
    return action and BoardUI.hit(b, action) or b
end

-- The 44dp tap box draws its icon inset; pulling the box out by this much
-- lines the glyph up with the page margin.
function MenuUI.tapInset(size)
    return math.floor((px(44) - px(size or 24)) / 2)
end

-- ------------------------------------------------------------------ rows
-- A list row. o: icon (name or widget), label, sub, sublines, value,
-- value_bold, toggle, radio, check, chevron, trail, bold, h, action, data.
function MenuUI.row(w, o)
    local trailing = {}
    if o.value then table.insert(trailing, text(o.value, { s = 14, col = o.value_bold and INK.black or INK.g4, b = o.value_bold })) end
    if o.trail then table.insert(trailing, o.trail) end
    if o.toggle ~= nil then table.insert(trailing, MenuUI.toggle(o.toggle)) end
    if o.radio ~= nil then table.insert(trailing, MenuUI.radio(o.radio)) end
    if o.check then table.insert(trailing, MenuUI.check()) end
    if o.chevron then table.insert(trailing, icon("chevron-right", px(18), { sw = 2.25 })) end
    local right = #trailing > 0 and hstack({ gap = px(10) }, trailing) or nil
    local icon_w = o.icon and (px(24) + px(14)) or 0
    local right_w = right and (right:getSize().w + px(12)) or 0
    local text_w = math.max(px(10), w - icon_w - right_w)
    local lines = o.sublines or 1
    local col_items = { text(o.label, { s = o.s or 16, b = o.bold, w = text_w, data = o.data }) }
    if o.sub then
        table.insert(col_items, text(o.sub, { s = 13, col = INK.g4, w = text_w, lines = lines, data = o.sub_data }))
    end
    local column = vstack({ w = text_w }, col_items)
    local min_h = px(o.h or (o.sub and (lines > 1 and 72 or 60) or 52))
    local h = math.max(min_h, column:getSize().h + px(16))
    local items = {}
    if o.icon then
        local glyph = type(o.icon) == "string" and icon(o.icon, px(22), { sw = 2 }) or o.icon
        table.insert(items, hstack({ w = px(24), h = h }, { flex(0), glyph, flex(0) }))
        table.insert(items, space(px(14), 1))
    end
    table.insert(items, column)
    if right then
        table.insert(items, flex(px(12)))
        table.insert(items, right)
    end
    local r = hstack({ w = w, h = h }, items)
    local out = o.action and BoardUI.hit(r, o.action) or r
    out._no_icon = o.icon == nil
    return out
end

-- Full-screen page header: back, title, optional sub line and a right widget,
-- in the same 64dp band as the board's header. o: back (false hides it),
-- back_icon, back_action, sub (string or runs), right, right_inset (px the
-- right widget may hang past the margin, for an icon button's tap box).
function MenuUI.pageHeader(w, title, o)
    o = o or {}
    local has_back = o.back ~= false
    local inset = has_back and MenuUI.tapInset(24) or 0
    local right = o.right
    local band_w = w + inset + (o.right_inset or 0)
    local back_w = has_back and (px(44) + px(4)) or 0
    local right_w = right and right:getSize().w or 0
    local title_w = band_w - back_w - right_w
    local column = vstack({ w = title_w }, {
        text(title, { s = 22, b = true, w = title_w }),
        o.sub and (type(o.sub) == "table" and BoardUI.runs(o.sub, { s = 13, col = INK.g4, w = title_w, data = true })
            or text(o.sub, { s = 13, col = INK.g4, w = title_w, data = o.sub_data })) or false,
    })
    local items = {}
    if has_back then
        table.insert(items, MenuUI.iconButton(o.back_icon or "chevron-left", o.back_action or { kind = "back" }, { size = 26, sw = 2.25 }))
        table.insert(items, space(px(4), 1))
    end
    table.insert(items, column)
    if right then table.insert(items, right) end
    local band = hstack({ w = band_w, h = px(64) }, items)
    -- The back glyph and a right icon button sit on the margins, their tap
    -- boxes reaching past them.
    return BoardUI.overlay(w, px(64), { { widget = band, x = -inset, y = 0 } })
end

-- ---------------------------------------------------------- illustrations
-- Gesture diagrams for the shortcut picker: a reader outline with the touch
-- drawn on it. Written once to the icon cache like the board's icons.
local GESTURE_SVG = {
    frame = '<rect x="8" y="4" width="84" height="122" rx="9" fill="#ffffff" stroke="#000000" stroke-width="3"/>'
        .. '<rect x="16" y="14" width="68" height="96" rx="2" fill="none" stroke="#888888" stroke-width="1.5"/>'
        .. '<path d="M24 28h52M24 40h52M24 52h52M24 64h52M24 76h52M24 88h30" stroke="#cccccc" stroke-width="3" stroke-linecap="round"/>',
    ["hold-tl"] = '<circle cx="24" cy="22" r="12" fill="none" stroke="#000000" stroke-width="2.5"/><circle cx="24" cy="22" r="7" fill="#000000"/>',
    ["tap-br"] = '<circle cx="76" cy="102" r="7" fill="#000000"/>',
    ["tap-tr"] = '<circle cx="76" cy="22" r="7" fill="#000000"/>',
    ["two-tr"] = '<circle cx="68" cy="22" r="6.5" fill="#000000"/><circle cx="80" cy="26" r="6.5" fill="#000000"/>',
    none = '<path d="M30 50 L70 90 M70 50 L30 90" stroke="#888888" stroke-width="3" stroke-linecap="round"/>',
}

local gesture_dir
local function gestureFile(kind)
    if not gesture_dir then
        gesture_dir = DataStorage:getDataDir() .. "/cache/bookorbit/icons"
        util.makePath(gesture_dir)
    end
    local path = gesture_dir .. "/gesture-" .. kind .. "-v1.svg"
    if lfs.attributes(path, "mode") ~= "file" then
        local f = io.open(path, "w")
        if not f then return nil end
        f:write('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="130" viewBox="0 0 100 130">'
            .. GESTURE_SVG.frame .. (GESTURE_SVG[kind] or "") .. "</svg>")
        f:close()
    end
    return path
end

function MenuUI.gesture(kind, w)
    local h = math.floor(w * 1.3 + 0.5)
    local file = gestureFile(kind)
    if not file then return space(w, h) end
    return IconWidget:new{ file = file, width = w, height = h, alpha = true }
end

-- The BookOrbit icon KOReader's menu bar shows, drawn from the shipped SVG.
function MenuUI.tabIcon(size, path)
    if not path or lfs.attributes(path, "mode") ~= "file" then return space(size, size) end
    return IconWidget:new{ file = path, width = size, height = size, alpha = true }
end

-- ------------------------------------------------------------------ text
-- "2 min ago", "3 h ago", "yesterday", "Oct 9". A timestamp of 0 is never.
local _ = require("gettext")
local T = require("ffi/util").template

function MenuUI.ago(ts, now)
    ts = tonumber(ts)
    if not ts or ts <= 0 then return nil end
    now = now or os.time()
    local delta = math.max(0, now - ts)
    if delta < 60 then return _("just now") end
    if delta < 3600 then return T(_("%1 min ago"), math.floor(delta / 60)) end
    if delta < 86400 and os.date("%Y%m%d", ts) == os.date("%Y%m%d", now) then
        return T(_("%1 h ago"), math.floor(delta / 3600))
    end
    if os.date("%Y%m%d", ts) == os.date("%Y%m%d", now - 86400) then return _("yesterday") end
    return os.date("%b %d", ts):gsub(" 0", " ")
end

-- The server's address without its scheme or API path, as people type it.
function MenuUI.serverHost(url)
    if type(url) ~= "string" or url == "" then return nil end
    local host = url:gsub("^%a[%w+.-]*://", ""):gsub("/api/v1/?$", ""):gsub("/+$", "")
    return host
end

MenuUI.lh1 = lh1

return MenuUI
