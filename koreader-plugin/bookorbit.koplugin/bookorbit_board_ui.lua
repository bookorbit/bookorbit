--[[--
Drawing primitives for the widget dashboard.

Sizes are pixels (convert dp with BoardMetrics.px); font sizes are nominal and
go through the board's density step. Stacks lay children out in a fixed box
with flexible spacers, which is how the dashboard's tiles get the same
proportions on every screen.

Widgets fit by construction: a widget offers layouts from richest to most
compact and BoardUI.pick keeps the first one that fits its tile. While a
candidate is built, the primitives report problems to the active fit check:
a stack whose fixed content is taller or wider than its box, a line of
interface text that had to be shortened, or two labels pushed together. Book
data (titles, authors, quotes) may be shortened; pass data = true for those.
]]

local BD = require("ui/bidi")
local CenterContainer = require("ui/widget/container/centercontainer")
local Screen = require("device").screen
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local LeftContainer = require("ui/widget/container/leftcontainer")
local OverlapGroup = require("ui/widget/overlapgroup")
local RenderImage = require("ui/renderimage")
local RightContainer = require("ui/widget/container/rightcontainer")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local Widget = require("ui/widget/widget")
local WidgetContainer = require("ui/widget/container/widgetcontainer")

local BoardIcons = require("bookorbit_board_icons")
local BoardMetrics = require("bookorbit_board_metrics")

local INK = BoardMetrics.INK
local px = BoardMetrics.px

local BoardUI = {}
BoardUI.INK = INK
BoardUI.px = px

-- KOReader's plain painters turn an RGB colour into its gray; RGB colours
-- (the board's colour schemes) go through the RGB32 painters instead.
local Blitbuffer = package.loaded["ffi/blitbuffer"] or select(2, pcall(require, "ffi/blitbuffer"))
if type(Blitbuffer) ~= "table" then Blitbuffer = {} end

-- A truthiness test, never == nil: LuaJIT hands a colour's comparison with
-- nil to its __eq, which indexes the other side.
local function isRGB(c)
    if not c or not Blitbuffer.isColor8 then return false end
    return not Blitbuffer.isColor8(c)
end
BoardUI.isRGB = isRGB

local function paintBorder(bb, x, y, w, h, bw, c, r)
    if isRGB(c) and bb.paintBorderRGB32 then
        bb:paintBorderRGB32(x, y, w, h, bw, c, r)
    else
        bb:paintBorder(x, y, w, h, bw, c, r)
    end
end

local function paintRoundedRect(bb, x, y, w, h, c, r)
    if isRGB(c) and bb.paintRoundedRectRGB32 then
        bb:paintRoundedRectRGB32(x, y, w, h, c, r)
    else
        bb:paintRoundedRect(x, y, w, h, c, r)
    end
end

-- ------------------------------------------------------------- fit checks
local fit_stack = {}

local function problem(kind, detail)
    local check = fit_stack[#fit_stack]
    if check then check.problems = check.problems + 1; check.last = kind; check.detail = detail end
end
BoardUI.problem = problem

-- Builds each candidate in turn and returns the first that reported no
-- problem, or the last one.
local DEBUG = os.getenv("BO_BOARD_DEBUG") ~= nil

-- Which candidate won, per widget, size and data. A widget's choice depends
-- only on those, so a rebuild (a page flip, a tile refresh) builds the
-- winner directly instead of trying the richer layouts again. Cleared when
-- the data changes.
local pick_memo, pick_memo_fp = {}, nil
local pick_scope = nil

-- Called by the tile builder around each widget: key names the widget and
-- its size, fingerprint the data it was drawn from.
function BoardUI.pickScope(key, fingerprint)
    if fingerprint ~= pick_memo_fp then
        pick_memo, pick_memo_fp = {}, fingerprint
    end
    pick_scope = key and { key = key, n = 0 } or nil
end

function BoardUI.pick(variants)
    local memo_key
    if pick_scope and #fit_stack == 0 then
        pick_scope.n = pick_scope.n + 1
        memo_key = pick_scope.key .. "#" .. pick_scope.n .. "/" .. #variants
        local won = pick_memo[memo_key]
        if won and variants[won] then return variants[won]() end
    end
    local result, won = nil, #variants
    for index = 1, #variants - 1 do
        table.insert(fit_stack, { problems = 0 })
        -- A candidate that cannot even be built (a box too narrow for its
        -- text) is just one that does not fit.
        local ok, node = pcall(variants[index])
        local check = table.remove(fit_stack)
        if not ok then check.problems, check.last, check.detail, node = 1, "error", tostring(node), nil end
        if check.problems == 0 then
            result, won = node, index
            break
        end
        if DEBUG then require("logger").info("BOARDFIT", BoardUI.debug_widget or "?", "variant", index, "rejected:", check.last, check.detail) end
        if node and node.free then node:free() end
    end
    if memo_key then pick_memo[memo_key] = won end
    return result or variants[#variants]()
end

-- Runs fn under a fit check and reports whether it fitted. For specs and the
-- fit audit, not for drawing.
function BoardUI.fits(fn)
    table.insert(fit_stack, { problems = 0 })
    local ok, node = pcall(fn)
    local check = table.remove(fit_stack)
    if not ok then return false, node end
    return check.problems == 0, node, check.last, check.detail
end

-- --------------------------------------------------------------- spacers
function BoardUI.space(w, h)
    if (w or 0) > 0 and (h or 0) > 0 then
        return VerticalGroup:new{ HorizontalSpan:new{ width = w }, VerticalSpan:new{ width = h } }
    end
    if (w or 0) > 0 then return HorizontalSpan:new{ width = w } end
    return VerticalSpan:new{ width = h or 0 }
end

-- A flexible spacer for vstack/hstack. min is the least it may shrink to.
function BoardUI.flex(min)
    return { _flex = true, min = min or 0 }
end

-- ------------------------------------------------------------------- text
local function faceKind(o)
    if o.serif then return o.i and "serif_italic" or "serif" end
    return o.i and "sans_italic" or "sans"
end

-- One line of text in an RGB colour. TextWidget paints glyphs in gray only,
-- so the line is set white on black once, which is its coverage mask, and
-- blitted in the colour. (Blitbuffer:invert only flips a flag that the C
-- blitter ignores when both buffers carry it, as a night-mode screen does.)
local ColourLine = Widget:extend{ line = nil, color = nil }

function ColourLine:getSize()
    return self.line:getSize()
end

function ColourLine:isTruncated()
    return self.line:isTruncated()
end

function ColourLine:paintTo(bb, x, y)
    local size = self.line:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    if not self.mask then
        local canvas = Blitbuffer.new(size.w, size.h, Blitbuffer.TYPE_BB8)
        canvas:fill(Blitbuffer.COLOR_BLACK)
        self.line:paintTo(canvas, 0, 0)
        self.mask = canvas
    end
    if bb.colorblitFromRGB32 then
        bb:colorblitFromRGB32(self.mask, x, y, 0, 0, size.w, size.h, self.color)
    else
        bb:colorblitFrom(self.mask, x, y, 0, 0, size.w, size.h, self.color)
    end
end

function ColourLine:free()
    if self.mask then self.mask:free(); self.mask = nil end
    if self.line and self.line.free then self.line:free() end
end

-- A single line, or o.lines lines when o.lines > 1. o: s (nominal size),
-- b, i, serif, col, w (box width), align, lines, data.
function BoardUI.text(str, o)
    o = o or {}
    local size = o.s or 14
    local face = BoardMetrics.face(size, faceKind(o))
    str = BD.auto(tostring(str or ""))
    local lines = o.lines or 1
    -- No room to set any text: report it and hold the space.
    if o.w and o.w < px(8) then
        problem("narrow", "text w=" .. o.w)
        return VerticalGroup:new{ HorizontalSpan:new{ width = math.max(0, o.w) },
            VerticalSpan:new{ width = lines > 1 and lines * BoardMetrics.lh(size) or BoardMetrics.lh1(size) } }
    end
    if lines > 1 then
        local tb = TextBoxWidget:new{
            text = str,
            face = face,
            bold = o.b == true,
            fgcolor = o.col or INK.black,
            -- TextBoxWidget paints its own background; match the surface
            -- it sits on.
            bgcolor = o.bg or BoardUI.surface or INK.white,
            width = o.w,
            height = lines * BoardMetrics.lh(size),
            height_adjust = true,
            height_overflow_show_ellipsis = true,
            alignment = o.align or "left",
        }
        if tb.line_with_ellipsis and not o.data then problem("clamped", str) end
        return tb
    end
    local rgb = isRGB(o.col) and Blitbuffer.TYPE_BB8 ~= nil
    local tw = TextWidget:new{
        text = str,
        padding = 0,
        face = face,
        bold = o.b == true,
        fgcolor = rgb and INK.white or (o.col or INK.black),
        max_width = o.w,
    }
    if o.w and tw:isTruncated() and not o.data then problem("ellipsis", str .. " w=" .. o.w .. " need=" .. tw:getSize().w) end
    if rgb then tw = ColourLine:new{ line = tw, color = o.col } end
    if not o.w then return tw end
    local dimen = Geom:new{ w = o.w, h = tw:getSize().h }
    if o.align == "center" then return CenterContainer:new{ dimen = dimen, tw } end
    if o.align == "right" then return RightContainer:new{ dimen = dimen, tw } end
    return LeftContainer:new{ dimen = dimen, tw }
end

-- The largest size from o.s down to min_s at which str fits one line of w,
-- so a label in a narrow column steps down before it is cut.
function BoardUI.fitSize(str, o, w, min_s)
    local size = o.s or 14
    local face_kind = faceKind(o)
    while size > (min_s or size) do
        local tw = TextWidget:new{ text = BD.auto(tostring(str or "")), face = BoardMetrics.face(size, face_kind), bold = o.b == true, padding = 0 }
        local fits = tw:getSize().w <= w
        tw:free()
        if fits then break end
        size = size - 1
    end
    return size
end

-- The largest of `sizes` at which `str` fits in max_lines lines and max_h
-- pixels, with the line count it takes there.
local fit_title_cache, fit_title_count = {}, 0

function BoardUI.fitTitle(str, o, width, sizes, max_lines, max_h)
    local key = table.concat({ tostring(str), tostring(o and o.b), tostring(o and o.serif), width, table.concat(sizes, ","), max_lines, tostring(max_h), BoardMetrics.get().dp }, "|")
    local hit = fit_title_cache[key]
    if hit then return { s = hit.s, lines = hit.lines } end
    local result = BoardUI._fitTitle(str, o, width, sizes, max_lines, max_h)
    if fit_title_count > 400 then fit_title_cache, fit_title_count = {}, 0 end
    fit_title_cache[key] = result
    fit_title_count = fit_title_count + 1
    return { s = result.s, lines = result.lines }
end

-- The widest single word of str at size s: a box narrower than it breaks
-- the word across lines.
local function widestWord(str, o, s)
    local widest = 0
    for word in tostring(str or ""):gmatch("%S+") do
        local tw = TextWidget:new{ text = BD.auto(word), face = BoardMetrics.face(s, faceKind(o or {})), bold = o and o.b == true, padding = 0 }
        widest = math.max(widest, tw:getSize().w)
        tw:free()
    end
    return widest
end

function BoardUI._fitTitle(str, o, width, sizes, max_lines, max_h)
    for index, s in ipairs(sizes) do
        local tb = TextBoxWidget:new{
            text = BD.auto(tostring(str or "")),
            face = BoardMetrics.face(s, faceKind(o or {})),
            bold = o and o.b == true,
            width = width,
        }
        local lines = math.max(1, math.floor(tb:getSize().h / BoardMetrics.lh(s) + 0.5))
        tb:free()
        -- A size that would split a word goes to the next one down.
        if lines <= max_lines and (not max_h or lines * BoardMetrics.lh(s) <= max_h)
                and (index == #sizes or lines == 1 or widestWord(str, o, s) <= width) then
            return { s = s, lines = lines }
        end
    end
    local s = sizes[#sizes]
    local lines = max_h and math.floor(max_h / BoardMetrics.lh(s)) or max_lines
    return { s = s, lines = math.max(1, math.min(max_lines, lines)) }
end

-- One line of styled runs on a shared baseline, e.g. a bold number followed
-- by a muted unit. parts: strings or { t, b, s, col, serif, i }.
function BoardUI.runs(parts, o)
    o = o or {}
    local base = o.s or 14
    local widgets = {}
    local max_base = 0
    local total = 0
    local tallest = 0
    for _i, p in ipairs(parts) do
        if type(p) == "string" then p = { t = p } end
        local size = p.s or base
        local tw = TextWidget:new{
            text = BD.auto(p.t),
            padding = 0,
            face = BoardMetrics.face(size, faceKind(p)),
            bold = p.b == true,
            fgcolor = p.col or o.col or INK.black,
        }
        table.insert(widgets, tw)
        max_base = math.max(max_base, tw:getBaseline())
        total = total + tw:getSize().w
        tallest = math.max(tallest, size)
    end
    local avail = o.w
    if avail and total > avail then
        -- Shorten the run that crosses the edge; drop the ones after it.
        local used = 0
        for index, tw in ipairs(widgets) do
            local w = tw:getSize().w
            if used + w > avail then
                local keep = avail - used
                if keep > px(12) then
                    tw:setMaxWidth(keep)
                    for j = #widgets, index + 1, -1 do table.remove(widgets, j) end
                else
                    for j = #widgets, index, -1 do table.remove(widgets, j) end
                end
                break
            end
            used = used + w
        end
        if not o.data then problem("ellipsis") end
    end
    local row_h = BoardMetrics.lh1(tallest)
    local group = HorizontalGroup:new{ align = "top" }
    for _i, tw in ipairs(widgets) do
        local top = max_base - tw:getBaseline()
        if top > 0 then
            table.insert(group, VerticalGroup:new{ align = "left", VerticalSpan:new{ width = top }, tw })
        else
            table.insert(group, tw)
        end
    end
    if not avail then
        return CenterContainer:new{ dimen = Geom:new{ w = group:getSize().w, h = row_h }, group }
    end
    local dimen = Geom:new{ w = avail, h = row_h }
    if o.align == "right" then return RightContainer:new{ dimen = dimen, group } end
    if o.align == "center" then return CenterContainer:new{ dimen = dimen, group } end
    return LeftContainer:new{ dimen = dimen, group }
end

-- ----------------------------------------------------------------- stacks
local function sizeOf(item)
    if type(item) == "table" and item._flex then return 0, 0 end
    local s = item:getSize()
    return s.w, s.h
end

-- Children top to bottom in a w x h box. Flex spacers share what is left.
-- o: w, h, align ("left", "center", "right"), pad (number or {t, r, b, l}), strict_padding.
function BoardUI.vstack(o, items)
    local pt, pr, pb, pl = 0, 0, 0, 0
    if type(o.pad) == "number" then pt, pr, pb, pl = o.pad, o.pad, o.pad, o.pad
    elseif type(o.pad) == "table" then pt, pr, pb, pl = o.pad[1], o.pad[2], o.pad[3], o.pad[4] end
    local widest = 0
    for _i, item in ipairs(items) do
        if item and not (type(item) == "table" and item._flex) then
            widest = math.max(widest, (sizeOf(item)))
        end
    end
    local box_w = o.w or (widest + pl + pr)
    local iw = box_w - pl - pr
    local fixed, flexes, flex_min = 0, 0, 0
    local present = {}
    for _i, item in ipairs(items) do
        if item then
            table.insert(present, item)
            if type(item) == "table" and item._flex then
                flexes = flexes + 1
                flex_min = flex_min + item.min
            else
                local w, h = sizeOf(item)
                fixed = fixed + h
                if w > iw + pr + 1 then problem("overflow-x", "vstack child w=" .. w .. " iw=" .. iw) end
            end
        end
    end
    local ih = o.h and (o.h - pt - pb) or (fixed + flex_min)
    local remaining = ih - fixed
    -- Content may overhang the bottom padding by a text line's own leading
    -- (2dp), never more: a fuller layout loses to a smaller one before a
    -- card's bottom margin looks thinner than its top.
    local padding_slack = o.strict_padding and 0 or math.min(pb, px(2))
    if remaining + padding_slack < flex_min - 0.5 then problem("overflow-y", "vstack need=" .. (fixed + flex_min) .. " have=" .. ih) end
    local left = math.max(0, remaining)
    local share = flexes > 0 and math.floor(left / flexes) or 0
    local extra = flexes > 0 and (left - share * flexes) or 0
    local Container = (o.align == "center" and CenterContainer) or (o.align == "right" and RightContainer) or LeftContainer
    local group = VerticalGroup:new{ align = "left" }
    if pt > 0 then table.insert(group, VerticalSpan:new{ width = pt }) end
    local used = pt
    local seen = 0
    for _i, item in ipairs(present) do
        if type(item) == "table" and item._flex then
            seen = seen + 1
            local h = math.max(item.min, share + (seen == flexes and extra or 0))
            table.insert(group, VerticalSpan:new{ width = h })
            used = used + h
        else
            local _, h = sizeOf(item)
            table.insert(group, Container:new{ dimen = Geom:new{ w = iw, h = h }, item })
            used = used + h
        end
    end
    local box_h = o.h or (used + pb)
    if used < box_h then table.insert(group, VerticalSpan:new{ width = box_h - used }) end
    return LeftContainer:new{
        dimen = Geom:new{ w = box_w, h = box_h },
        HorizontalGroup:new{ align = "top", HorizontalSpan:new{ width = pl }, group },
    }
end

-- Children left to right. o: w, h, gap, valign ("center", "top", "bottom").
-- A flex spacer's min is the least room it needs; less counts as labels
-- touching.
function BoardUI.hstack(o, items)
    local gap = o.gap or 0
    local fixed, flexes, flex_min = 0, 0, 0
    local present = {}
    local tallest = 0
    for _i, item in ipairs(items) do
        if item then
            table.insert(present, item)
            if type(item) == "table" and item._flex then
                flexes = flexes + 1
                flex_min = flex_min + item.min
            else
                local w, h = sizeOf(item)
                fixed = fixed + w
                tallest = math.max(tallest, h)
            end
        end
    end
    local gaps = math.max(0, #present - 1) * gap
    local width = o.w or (fixed + gaps + flex_min)
    local remaining = width - fixed - gaps
    if remaining < flex_min - 0.5 then problem(flexes > 0 and "tight" or "overflow-x", "hstack need=" .. (fixed + gaps + flex_min) .. " have=" .. width) end
    local h = o.h or tallest
    if tallest > h + 1 then problem("overflow-y", "hstack tallest=" .. tallest .. " h=" .. h) end
    local valign = o.valign or "center"
    local group = HorizontalGroup:new{ align = valign }
    local left = math.max(0, remaining)
    local share = flexes > 0 and math.floor(left / flexes) or 0
    local extra = flexes > 0 and (left - share * flexes) or 0
    local seen = 0
    for index, item in ipairs(present) do
        if index > 1 and gap > 0 then table.insert(group, HorizontalSpan:new{ width = gap }) end
        if type(item) == "table" and item._flex then
            seen = seen + 1
            table.insert(group, HorizontalSpan:new{ width = math.max(item.min, share + (seen == flexes and extra or 0)) })
        else
            table.insert(group, item)
        end
    end
    local gh = math.min(h, tallest)
    local above = valign == "top" and 0 or valign == "bottom" and (h - gh) or math.floor((h - gh) / 2)
    return LeftContainer:new{
        dimen = Geom:new{ w = width, h = h },
        VerticalGroup:new{ align = "left", VerticalSpan:new{ width = above }, group, VerticalSpan:new{ width = h - gh - above } },
    }
end

-- Label on the left, an optional widget on the right, and at least 4dp
-- between them. The header row every tile starts with.
function BoardUI.spread(w, left, right, h)
    if not right then
        return BoardUI.hstack({ w = w, h = h }, { left, BoardUI.flex(0) })
    end
    return BoardUI.hstack({ w = w, h = h }, { left, BoardUI.flex(px(4)), right })
end

-- ----------------------------------------------------------------- frames
-- An RGB border painted over a frame of the same size.
local ColourRing = Widget:extend{ bw = 1, color = nil, radius = 0 }

function ColourRing:getSize()
    return self.dimen
end

function ColourRing:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    paintBorder(bb, x, y, self.dimen.w, self.dimen.h, self.bw, self.color, self.radius)
end

-- A fixed box with an optional fill, radius and inner border.
function BoardUI.box(o, child)
    local border = o.border or 0
    local inner_w, inner_h = o.w - 2 * border, o.h - 2 * border
    if border > 0 and isRGB(o.border_col) then
        local plain = {}
        for k, v in pairs(o) do plain[k] = v end
        plain.border_col = INK.white
        return BoardUI.overlay(o.w, o.h, {
            { widget = BoardUI.box(plain, child) },
            { widget = ColourRing:new{ dimen = Geom:new{ w = o.w, h = o.h }, bw = border, color = o.border_col, radius = o.radius or 0 } },
        })
    end
    return FrameContainer:new{
        margin = 0,
        padding = 0,
        bordersize = border,
        color = o.border_col or INK.black,
        radius = o.radius,
        background = o.bg,
        LeftContainer:new{
            dimen = Geom:new{ w = math.max(1, inner_w), h = math.max(1, inner_h) },
            child or HorizontalSpan:new{ width = 0 },
        },
    }
end

-- A progress bar: track, fill and optional rounded ends.
function BoardUI.bar(w, h, pct, o)
    o = o or {}
    pct = math.max(0, math.min(100, pct or 0))
    local fill_w = math.floor(w * pct / 100 + 0.5)
    if pct > 0 then fill_w = math.max(fill_w, math.max(1, px(1.5))) end
    local r = o.r or 0
    local track = FrameContainer:new{
        margin = 0, padding = 0, bordersize = 0, radius = r,
        background = o.track or INK.gc,
        LeftContainer:new{
            dimen = Geom:new{ w = w, h = h },
            fill_w > 0 and FrameContainer:new{
                margin = 0, padding = 0, bordersize = 0, radius = r,
                background = o.fill or INK.black,
                HorizontalGroup:new{ HorizontalSpan:new{ width = fill_w }, VerticalSpan:new{ width = h } },
            } or HorizontalSpan:new{ width = 0 },
        },
    }
    return track
end

-- A dot: filled, or an outlined ring.
function BoardUI.dot(size, on, o)
    o = o or {}
    return FrameContainer:new{
        margin = 0, padding = 0,
        bordersize = on and 0 or math.max(1, px(1.25)),
        color = o.off or INK.ga,
        radius = math.floor(size / 2),
        background = on and (o.col or INK.black) or nil,
        HorizontalGroup:new{
            HorizontalSpan:new{ width = size - (on and 0 or 2 * math.max(1, px(1.25))) },
            VerticalSpan:new{ width = size - (on and 0 or 2 * math.max(1, px(1.25))) },
        },
    }
end

-- A rectangle of solid colour.
function BoardUI.rect(w, h, col, r)
    return FrameContainer:new{
        margin = 0, padding = 0, bordersize = 0, radius = r,
        background = col,
        HorizontalGroup:new{ HorizontalSpan:new{ width = math.max(0, w) }, VerticalSpan:new{ width = math.max(0, h) } },
    }
end

-- An icon. o: col (an INK key), sw, fill.
function BoardUI.icon(name, size, o)
    o = o or {}
    return BoardIcons.widget(name, size, {
        color = BoardMetrics.INK_HEX[o.col or "black"] or o.col,
        sw = o.sw or 2,
        fill = o.fill,
    })
end

-- A circle of diameter d with an icon centred in it.
function BoardUI.circle(d, o, child)
    local border = o.border or 0
    return FrameContainer:new{
        margin = 0, padding = 0,
        bordersize = border,
        color = o.border_col or INK.black,
        radius = math.floor(d / 2),
        background = o.bg,
        CenterContainer:new{ dimen = Geom:new{ w = d - 2 * border, h = d - 2 * border }, child },
    }
end

-- --------------------------------------------------------------- hit areas
-- A transparent wrapper that remembers where it was painted, so a tap on a
-- tile can go to exactly what was drawn under the finger.
local HitArea = WidgetContainer:extend{
    action = nil,
}

function HitArea:getSize()
    return self[1]:getSize()
end

function HitArea:paintTo(bb, x, y)
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = x, y = y, w = size.w, h = size.h }
    self[1]:paintTo(bb, x, y)
end

local hit_sinks = {}

-- Marks child as tappable with `action`, recorded on the tile being built.
function BoardUI.hit(child, action)
    local area = HitArea:new{ action = action, child }
    local sink = hit_sinks[#hit_sinks]
    if sink then table.insert(sink, area) end
    return area
end

-- How many hit areas the current build has made, and dropping the ones made
-- after a mark: a layout built, measured and then rebuilt another way.
function BoardUI.hitMark()
    local sink = hit_sinks[#hit_sinks]
    return sink and #sink or 0
end

function BoardUI.hitTrim(mark)
    local sink = hit_sinks[#hit_sinks]
    if not sink then return end
    for i = #sink, mark + 1, -1 do table.remove(sink, i) end
end

-- Runs fn and returns its result plus the hit areas it created.
function BoardUI.collectHits(fn)
    local sink = {}
    table.insert(hit_sinks, sink)
    local ok, result = pcall(fn)
    table.remove(hit_sinks)
    if not ok then error(result, 0) end
    return result, sink
end

-- Wi-Fi, battery and the clock: the device status both full pages show.
function BoardUI.statusCluster(d)
    local wifi_on = require("ui/network/manager"):isWifiOn() and require("ui/network/manager"):isConnected()
    local powerd = require("device"):getPowerDevice()
    local items = {}
    table.insert(items, BoardUI.icon(wifi_on and "wifi" or "wifi-off", px(15), { col = wifi_on and "black" or "g4", sw = 2.25 }))
    if require("device"):hasBattery() then
        local capacity = powerd:getCapacity() or 0
        local bw, bh = px(21), px(11)
        local b = math.max(1, px(1.25))
        local inner_pad = px(1.5)
        local fill_w = math.max(1, math.floor((bw - 2 * b - 2 * inner_pad) * capacity / 100 + 0.5))
        local body = BoardUI.box({ w = bw, h = bh, border = b, radius = px(2.5) },
            BoardUI.hstack({ h = bh - 2 * b }, { BoardUI.space(inner_pad, 1), BoardUI.rect(fill_w, bh - 2 * b - 2 * inner_pad, INK.black, px(1)) }))
        local nub = BoardUI.rect(px(2), px(4.5), INK.black)
        table.insert(items, BoardUI.hstack({ gap = px(4) }, { BoardUI.hstack({}, { body, nub }), BoardUI.text(tostring(capacity) .. "%", { s = 12, col = INK.g4 }) }))
    end
    table.insert(items, BoardUI.text(d.clock, { s = 12, b = true }))
    return BoardUI.hstack({ gap = px(7) }, items)
end

-- ------------------------------------------------------------------ covers
-- Scaled covers are decoded once per size and kept, so flipping pages and
-- partial refreshes do not decode again. Bounded to keep memory flat.
local COVER_CACHE_MAX = 48
local cover_cache = {}
local cover_order = {}

local aspect_cache = {}

-- The cover scaled for a w x h box: cropped to fill when its shape is within
-- tol (12% unless given) of the box, fitted otherwise. One decode serves both
-- the shape check and the scale.
local function cachedCover(path, w, h, tol)
    tol = tol or 0.12
    local key = path .. "|" .. w .. "x" .. h .. "|" .. tol
    local hit = cover_cache[key]
    if hit then return hit end
    local ok, native = pcall(RenderImage.renderImageFile, RenderImage, path, false)
    if not ok or not native then return nil end
    local iw, ih = native:getWidth(), native:getHeight()
    aspect_cache[path] = iw / ih
    local box_aspect = w / h
    local crop = math.abs(iw / ih - box_aspect) / box_aspect <= tol
    local scale = crop and math.max(w / iw, h / ih) or math.min(w / iw, h / ih)
    local sw, sh = math.max(1, math.floor(iw * scale + 0.5)), math.max(1, math.floor(ih * scale + 0.5))
    local scaled = RenderImage:scaleBlitBuffer(native, sw, sh, true)
    hit = { bb = scaled, w = sw, h = sh, crop = crop }
    cover_cache[key] = hit
    table.insert(cover_order, key)
    while #cover_order > COVER_CACHE_MAX do
        local old = table.remove(cover_order, 1)
        local entry = cover_cache[old]
        if entry and entry.bb then entry.bb:free() end
        cover_cache[old] = nil
    end
    return hit
end

function BoardUI.clearCoverCache()
    for _i, entry in pairs(cover_cache) do
        if entry.bb then entry.bb:free() end
    end
    cover_cache, cover_order = {}, {}
end

-- The cover's native shape, from the decode the board already did, or a
-- decode of its own when the cover has not been drawn yet.
BoardUI.cachedCover = cachedCover

function BoardUI.nativeAspect(path)
    if aspect_cache[path] then return aspect_cache[path] end
    local ok, native = pcall(RenderImage.renderImageFile, RenderImage, path, false)
    if not ok or not native then return nil end
    aspect_cache[path] = native:getWidth() / native:getHeight()
    native:free()
    return aspect_cache[path]
end

local BoardCover = Widget:extend{
    path = nil,
    aspect = nil,
    border = 0,
    border_col = nil,
    dim = false,
    -- A lighter film than dim, as an amount for lightenRect (0 to 1).
    lighten = nil,
    valign = "bottom",
    crop_tol = nil,
    plate = false,
}

function BoardCover:getSize()
    return self.dimen
end

function BoardCover:paintTo(bb, x, y)
    local w, h = self.dimen.w, self.dimen.h
    self.dimen.x, self.dimen.y = x, y
    local img = cachedCover(self.path, w, h, self.crop_tol)
    if not img then
        bb:paintRect(x, y, w, h, INK.ge)
        return
    end
    -- A plate: an image of another shape sits centred on a gray box the size
    -- of the cover, so marks drawn on the box land on a defined shape.
    if self.plate and not img.crop then
        bb:paintRect(x, y, w, h, INK.ge)
        local px_, py_ = x + math.floor((w - img.w) / 2), y + math.floor((h - img.h) / 2)
        bb:blitFrom(img.bb, px_, py_, 0, 0, img.w, img.h)
        if self.dim then bb:lightenRect(x, y, w, h, 0.55) end
        if Screen.night_mode then bb:invertRect(px_, py_, img.w, img.h) end
        if self.border > 0 then paintBorder(bb, px_, py_, img.w, img.h, self.border, self.border_col or INK.gb) end
        return
    end
    local dx, dy, dw, dh
    if img.crop then
        local ox, oy = math.floor((img.w - w) / 2), math.floor((img.h - h) / 2)
        bb:blitFrom(img.bb, x, y, ox, oy, w, h)
        dx, dy, dw, dh = x, y, w, h
    else
        -- Square audiobook art and other outliers stand on the box's bottom
        -- edge, or hang from its top when the box sits beside text.
        dx = x + math.floor((w - img.w) / 2)
        dy = self.valign == "top" and y or y + (h - img.h)
        bb:blitFrom(img.bb, dx, dy, 0, 0, img.w, img.h)
        dw, dh = img.w, img.h
    end
    if self.dim then
        bb:lightenRect(dx, dy, dw, dh, 0.55)
    elseif self.lighten then
        bb:lightenRect(dx, dy, dw, dh, self.lighten)
    end
    if Screen.night_mode then
        bb:invertRect(dx, dy, dw, dh)
    end
    if self.border > 0 then
        paintBorder(bb, dx, dy, dw, dh, self.border, self.border_col or INK.gb)
    end
end

-- A book cover at an exact box. o: border (px), border_col, dim, lighten, path,
-- valign ("top" or the default "bottom") for an image of another shape,
-- placeholder title when there is no image.
-- The placeholder title's size: the largest at which every word (split
-- after hyphens, where lines may break) fits the cover's width, so a narrow
-- cover never breaks a word in two.
local PLACEHOLDER_SIZES = { 14, 13, 12, 11, 10, 9 }
local placeholder_cache, placeholder_count = {}, 0

local function placeholderSize(title, w)
    local key = title .. "|" .. w .. "|" .. BoardMetrics.get().dp
    local hit = placeholder_cache[key]
    if hit then return hit end
    local result = PLACEHOLDER_SIZES[#PLACEHOLDER_SIZES]
    for _i, s in ipairs(PLACEHOLDER_SIZES) do
        local face = BoardMetrics.face(s, "serif")
        local fits = true
        for word in title:gmatch("[^%s%-]+%-?") do
            local tw = TextWidget:new{ text = word, face = face, bold = true, padding = 0 }
            local word_w = tw:getSize().w
            tw:free()
            if word_w > w then fits = false; break end
        end
        if fits then result = s; break end
    end
    if placeholder_count > 400 then placeholder_cache, placeholder_count = {}, 0 end
    placeholder_cache[key] = result
    placeholder_count = placeholder_count + 1
    return result
end

function BoardUI.cover(book, w, h, o)
    o = o or {}
    if o.path then
        return BoardCover:new{
            dimen = Geom:new{ w = w, h = h },
            path = o.path,
            border = o.border or 0,
            border_col = o.border_col,
            dim = o.dim == true,
            lighten = o.lighten,
            valign = o.valign or "bottom",
            crop_tol = o.crop_tol,
            plate = o.plate == true,
        }
    end
    -- No image yet: a quiet placeholder with the title, never an empty hole.
    local pad = px(8)
    local frame_b = math.max(1, px(1))
    local inner = {}
    local title = book and book.title or ""
    local tw = w - 2 * pad - 2 * frame_b
    local s = placeholderSize(title, tw)
    -- The title takes the lines the cover has room for, up to four; a cover
    -- too small for one line stays an empty frame.
    local lines = math.min(4, math.floor((h - 2 * frame_b - 2 * pad) / BoardMetrics.lh(s)))
    if o.loading ~= true and w > px(48) and lines >= 1 then
        inner = { BoardUI.flex(0), BoardUI.text(title, { s = s, b = true, serif = true, lines = lines, w = tw, align = "center", data = true, bg = INK.ge }), BoardUI.flex(0) }
    end
    return BoardUI.box({ w = w, h = h, border = frame_b, border_col = INK.black, bg = INK.ge },
        BoardUI.vstack({ w = w - 2 * frame_b, h = h - 2 * frame_b, pad = pad, align = "center" }, inner))
end

-- Many small rounded squares painted in one pass: the heatmap and calendar
-- grids. A widget per cell would cost a FrameContainer each; this is a loop
-- of paintRoundedRect calls. cells: { x, y, col, ring } in box coordinates;
-- ring draws a black outline with a white gap around that cell.
local CellGrid = Widget:extend{
    cells = nil,
    size = 0,
    radius = 0,
}

function CellGrid:getSize()
    return self.dimen
end

function CellGrid:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local s, r = self.size, self.radius
    for _i, cell in ipairs(self.cells) do
        if cell.ring then
            local ring, gap = math.max(2, px(2)), math.max(1, px(1))
            bb:paintRoundedRect(x + cell.x - ring, y + cell.y - ring, s + 2 * ring, s + 2 * ring, INK.black, r + ring)
            bb:paintRoundedRect(x + cell.x - gap, y + cell.y - gap, s + 2 * gap, s + 2 * gap, INK.white, r + gap)
        end
        if cell.border and isRGB(cell.col) and bb.paintBorderRGB32 then
            bb:paintBorderRGB32(x + cell.x, y + cell.y, s, s, cell.border, cell.col, r, true)
        elseif cell.border then
            bb:paintBorder(x + cell.x, y + cell.y, s, s, cell.border, cell.col, r, true)
        else
            paintRoundedRect(bb, x + cell.x, y + cell.y, s, s, cell.col, r)
        end
    end
end

function BoardUI.cellGrid(w, h, size, radius, cells)
    return CellGrid:new{ dimen = Geom:new{ w = w, h = h }, cells = cells, size = size, radius = radius }
end

-- Painted bottom to top, but asked about taps top to bottom, so a bar or a
-- badge drawn over a tile gets its own taps.
local TopFirstGroup = OverlapGroup:extend{}

function TopFirstGroup:propagateEvent(event)
    for index = #self, 1, -1 do
        local widget = self[index]
        if widget and widget:handleEvent(event) then return true end
    end
    return false
end

-- Several widgets painted over one another at given offsets.
function BoardUI.overlay(w, h, layers)
    local group = TopFirstGroup:new{ dimen = Geom:new{ w = w, h = h } }
    for _i, layer in ipairs(layers) do
        if layer.widget then
            layer.widget.overlap_offset = { layer.x or 0, layer.y or 0 }
            table.insert(group, layer.widget)
        end
    end
    return group
end

-- --------------------------------------------------------------- snapshots
-- A widget drawn once at full size into an offscreen buffer and scaled down:
-- the starter layouts and widget previews. Kept until cleared, so repaints
-- and partial refreshes do not draw them again.
local snapshot_cache = {}

local Snapshot = Widget:extend{ key = nil }

function Snapshot:getSize()
    return self.dimen
end

function Snapshot:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local hit = snapshot_cache[self.key]
    if hit and hit.bb then bb:blitFrom(hit.bb, x, y, 0, 0, hit.bb:getWidth(), hit.bb:getHeight()) end
end

function BoardUI.snapshot(key, full_w, full_h, w, h, build)
    if not snapshot_cache[key] then
        local Screen = require("device").screen
        local Blitbuffer_ = require("ffi/blitbuffer")
        -- KOReader's MuPDF scaler keeps the 16-bit stride when it widens RGB565 and throws, so the
        -- reMarkable's RGB565 screen draws its thumbnails in RGB32 instead.
        local canvas_type = Screen.bb:getType()
        if canvas_type == Blitbuffer_.TYPE_BBRGB16 then canvas_type = Blitbuffer_.TYPE_BBRGB32 end
        local canvas = Blitbuffer_.new(full_w, full_h, canvas_type)
        canvas:fill(INK.white)
        -- Built in a sink of its own: a thumbnail's buttons are not tappable.
        local widget = BoardUI.collectHits(build)
        widget:paintTo(canvas, 0, 0)
        if widget.free then widget:free() end
        snapshot_cache[key] = { bb = RenderImage:scaleBlitBuffer(canvas, w, h, true) }
    end
    return Snapshot:new{ key = key, dimen = Geom:new{ w = w, h = h } }
end

function BoardUI.clearSnapshots(prefix)
    for key, hit in pairs(snapshot_cache) do
        if not prefix or key:sub(1, #prefix) == prefix then
            if hit.bb then hit.bb:free() end
            snapshot_cache[key] = nil
        end
    end
end

return BoardUI
