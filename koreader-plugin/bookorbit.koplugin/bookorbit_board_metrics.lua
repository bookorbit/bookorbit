--[[--
Shared geometry for the widget dashboard.

Every size on the board is given in density-independent units (dp) and
converted here, so the board scales like the rest of KOReader
(Screen:scaleBySize, short side / 600) plus one density step: a 10" panel
shows more content instead of the 6" page blown up, and a phone gets
finger-sized type. The reader's interface-size preference is applied after
that device adjustment. Font sizes go through the same scale, so text and
boxes stay in proportion.

Line heights mirror the widgets that draw them: a single-line TextWidget is
ceil(face height) tall, where Noto's face height is 1.362 em, and a
TextBoxWidget line is round(1.3 em).
]]

local Blitbuffer = require("ffi/blitbuffer")
local Device = require("device")
local Font = require("ui/font")

local Screen = Device.screen

local BoardMetrics = {}

BoardMetrics.UI_SCALES = { 1, 1.05, 1.1, 1.15, 1.2 }
BoardMetrics.DEFAULT_UI_SCALE = 1.05

local FACE_HEIGHT_EM = 1.362
local FACES = {
    sans = "NotoSans-Regular.ttf",
    sans_italic = "NotoSans-Italic.ttf",
    serif = "NotoSerif-Regular.ttf",
    serif_italic = "NotoSerif-Italic.ttf",
}

-- The sixteen gray levels e-ink panels can show, by name.
BoardMetrics.INK = {
    black = Blitbuffer.COLOR_BLACK,
    g1 = Blitbuffer.COLOR_GRAY_1,
    g2 = Blitbuffer.COLOR_GRAY_2,
    g3 = Blitbuffer.COLOR_GRAY_3,
    g4 = Blitbuffer.COLOR_GRAY_4,
    g5 = Blitbuffer.COLOR_GRAY_5,
    g6 = Blitbuffer.COLOR_GRAY_6,
    g7 = Blitbuffer.COLOR_GRAY_7,
    g8 = Blitbuffer.COLOR_DARK_GRAY,
    g9 = Blitbuffer.COLOR_GRAY_9,
    ga = Blitbuffer.COLOR_GRAY,
    gb = Blitbuffer.COLOR_GRAY_B,
    gc = Blitbuffer.COLOR_LIGHT_GRAY,
    gd = Blitbuffer.COLOR_GRAY_D,
    ge = Blitbuffer.COLOR_GRAY_E,
    white = Blitbuffer.COLOR_WHITE,
}

-- Hex values of the same grays, for the SVG icons drawn in them.
BoardMetrics.INK_HEX = {
    black = "#000000", g1 = "#111111", g2 = "#222222", g3 = "#333333", g4 = "#444444",
    g5 = "#555555", g6 = "#666666", g7 = "#777777", g8 = "#888888", g9 = "#999999",
    ga = "#aaaaaa", gb = "#bbbbbb", gc = "#cccccc", gd = "#dddddd", ge = "#eeeeee", white = "#ffffff",
}

local cache = nil
local user_scale = BoardMetrics.DEFAULT_UI_SCALE

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

function BoardMetrics.normalizeUserScale(value)
    local numeric = tonumber(value)
    if not numeric then return BoardMetrics.DEFAULT_UI_SCALE end
    local rounded = math.floor(numeric * 100 + 0.5) / 100
    if rounded == 1.25 then return 1.2 end
    for _, scale in ipairs(BoardMetrics.UI_SCALES) do
        if rounded == scale then return scale end
    end
    return BoardMetrics.DEFAULT_UI_SCALE
end

function BoardMetrics.setUserScale(value)
    user_scale = BoardMetrics.normalizeUserScale(value)
    cache = nil
    return user_scale
end

-- The density step: sqrt of how much shorter or longer the panel's short side
-- is than a 6" one (3.6"), kept gentle and within [0.78, 1.12].
function BoardMetrics.densityAdjust(short_px, dpi)
    if not short_px or not dpi or dpi <= 0 then return 1 end
    local inches = short_px / dpi
    local adj = clamp(math.sqrt(3.6 / inches), 0.78, 1.12)
    return math.floor(adj * 100 + 0.5) / 100
end

-- Recomputed when the screen geometry changes (rotation, DPI override).
function BoardMetrics.refresh()
    local w, h = Screen:getWidth(), Screen:getHeight()
    local short = math.min(w, h)
    local adj = BoardMetrics.densityAdjust(short, Screen:getDPI())
    -- Screen:scaleBySize's own scale: the short side over 600, averaged with
    -- DPI / 160 under a user DPI override. Computed here rather than read
    -- back from scaleBySize(1e6), which rounds up at the sixth decimal and
    -- turns an exact 600 dp screen into 599.9994.
    local size_scale = short / 600
    local dpi_scale = Screen.dpi_override and (Screen:getDPI() / 160) or size_scale
    local base = (size_scale + dpi_scale) / 2
    cache = {
        w = w,
        h = h,
        adj = adj,
        scale = user_scale,
        dp = base * adj * user_scale,
    }
    cache.W = w / cache.dp
    cache.H = h / cache.dp
    return cache
end

function BoardMetrics.get()
    if not cache or cache.w ~= Screen:getWidth() or cache.h ~= Screen:getHeight() then
        BoardMetrics.refresh()
    end
    return cache
end

-- dp to device pixels. Rounded up so a positive size never collapses to 0.
function BoardMetrics.px(n)
    if not n or n <= 0 then return 0 end
    return math.ceil(n * BoardMetrics.get().dp - 1e-7)
end

-- The pixel size of a font of nominal size n.
function BoardMetrics.fs(n)
    return BoardMetrics.px(n)
end

-- KOReader applies Screen:scaleBySize inside Font:getFace, so named and file
-- faces receive only BookOrbit's density and interface-size multipliers.
function BoardMetrics.fontSize(n)
    local metrics = BoardMetrics.get()
    return n * metrics.adj * metrics.scale
end

function BoardMetrics.namedFace(name, n)
    return Font:getFace(name, BoardMetrics.fontSize(n))
end

function BoardMetrics.fileFace(file, n)
    return Font:getFace(file, BoardMetrics.fontSize(n))
end

-- Single-line text height (TextWidget) for nominal size n.
function BoardMetrics.lh1(n)
    return math.ceil(FACE_HEIGHT_EM * BoardMetrics.fs(n) - 1e-7)
end

-- Line height of a TextBoxWidget for nominal size n.
function BoardMetrics.lh(n)
    return math.floor(1.3 * BoardMetrics.fs(n) + 0.5)
end

-- Height of an n-line TextBoxWidget of nominal size: lines of round(1.3 em)
-- plus the amount Noto's 1.362 em glyph box overflows one line, which
-- TextBoxWidget adds below the last line. One line is a TextWidget instead.
function BoardMetrics.textBoxHeight(lines, n)
    if lines <= 1 then return BoardMetrics.lh1(n) end
    local line = BoardMetrics.lh(n)
    local face = FACE_HEIGHT_EM * BoardMetrics.fs(n)
    return lines * line + math.max(0, -math.floor(line - face))
end

-- A face at nominal size n. Font:getFace applies scaleBySize itself, so it is
-- given the size with only the density step applied.
function BoardMetrics.face(n, kind)
    local file = FACES[kind or "sans"] or FACES.sans
    return BoardMetrics.fileFace(file, n)
end

-- Rebuilds without a screen, for specs.
function BoardMetrics._setForTest(values)
    cache = values
end

return BoardMetrics
