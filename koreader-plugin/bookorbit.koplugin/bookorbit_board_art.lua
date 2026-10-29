--[[--
Pictures for the decor widgets: vector art, pixel sprites and single glyphs.

Vector art is one SVG per picture, drawn by KOReader's own SVG renderer
(NanoSVG: paths, circles, ellipses, lines, rects and arcs) at exactly the size
it is shown at, then kept in memory by content, so a page flip or a tile
refresh blits it again instead of rendering. SVG is only ever a file to
NanoSVG, so each render goes through one scratch file that is overwritten.

Pixel sprites are runs of solid rectangles at a whole or half step of scale,
so they stay sharp on every screen, in colour on a colour screen and in grey
on any other. A glyph is one character rendered by FreeType at an exact pixel
size and drawn as its ink alone, without the line box around it, so a large
letter can fill a tile.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Device = require("device")
local Geom = require("ui/geometry")
local RenderImage = require("ui/renderimage")
local Widget = require("ui/widget/widget")
local bit = require("bit")
local logger = require("logger")

local Screen = Device.screen

local BoardArt = {}

-- ------------------------------------------------------------------ svg
local CACHE_MAX = 32
local svg_cache, svg_order = {}, {}
local scratch_path = nil

local function scratchPath()
    if not scratch_path then
        local dir = require("datastorage"):getDataDir() .. "/cache/bookorbit"
        require("util").makePath(dir)
        scratch_path = dir .. "/board-art.svg"
    end
    return scratch_path
end

local function hashOf(str)
    local ok, sha2 = pcall(require, "ffi/sha2")
    if ok and sha2 and sha2.md5 then return sha2.md5(str) end
    return str
end

local function rendered(svg, w, h)
    local key = hashOf(svg) .. "|" .. w .. "x" .. h
    local hit = svg_cache[key]
    if hit then return hit end
    local path = scratchPath()
    local f = io.open(path, "w")
    if not f then return nil end
    f:write(svg)
    f:close()
    local ok, bb = pcall(RenderImage.renderSVGImageFile, RenderImage, path, w, h)
    if not ok or not bb then
        logger.warn("BookOrbit: board art did not render:", ok and "no image" or bb)
        return nil
    end
    hit = { bb = bb }
    svg_cache[key] = hit
    table.insert(svg_order, key)
    while #svg_order > CACHE_MAX do
        local old = table.remove(svg_order, 1)
        local entry = svg_cache[old]
        if entry and entry.bb then entry.bb:free() end
        svg_cache[old] = nil
    end
    return hit
end

function BoardArt.clearCache()
    for _key, entry in pairs(svg_cache) do
        if entry.bb then entry.bb:free() end
    end
    svg_cache, svg_order = {}, {}
end

local ArtWidget = Widget:extend{ svg = nil }

function ArtWidget:getSize()
    return self.dimen
end

function ArtWidget:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local img = rendered(self.svg, self.dimen.w, self.dimen.h)
    if not img then return end
    -- NanoSVG hands back straight alpha.
    if Screen.sw_dithering then
        bb:ditheralphablitFrom(img.bb, x, y, 0, 0, self.dimen.w, self.dimen.h)
    else
        bb:alphablitFrom(img.bb, x, y, 0, 0, self.dimen.w, self.dimen.h)
    end
end

-- A picture of exactly w x h pixels from SVG markup drawn in pixel units.
function BoardArt.svg(w, h, body)
    w, h = math.max(1, math.floor(w + 0.5)), math.max(1, math.floor(h + 0.5))
    local svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' .. w .. '" height="' .. h
        .. '" viewBox="0 0 ' .. w .. ' ' .. h .. '">' .. body .. '</svg>'
    return ArtWidget:new{ svg = svg, dimen = Geom:new{ w = w, h = h } }
end

-- Numbers in SVG source, at two decimals.
function BoardArt.n(v)
    local s = string.format("%.2f", v)
    s = s:gsub("0+$", ""):gsub("%.$", "")
    if s == "-0" then return "0" end
    return s
end

-- --------------------------------------------------------------- sprites
-- Where cell i starts at scale k. Whole pixels, so a half step (1.5x)
-- alternates one- and two-pixel cells instead of blurring them.
local function edge(i, k)
    return math.floor(i * k + 1e-6)
end
BoardArt.spriteEdge = edge

-- Rows become runs of one character once; a repaint only fills rectangles.
local runs_of = setmetatable({}, { __mode = "k" })

local function runs(rows)
    local out = runs_of[rows]
    if out then return out end
    out = {}
    for row_index, line in ipairs(rows) do
        local col, len = 1, #line
        while col <= len do
            local ch = line:sub(col, col)
            local run_end = col
            while run_end < len and line:sub(run_end + 1, run_end + 1) == ch do run_end = run_end + 1 end
            if ch ~= " " then table.insert(out, { row_index - 1, col - 1, run_end, ch }) end
            col = run_end + 1
        end
    end
    runs_of[rows] = out
    return out
end

-- Each palette character's ink on this screen: its colour on a colour screen,
-- its grey otherwise. Night mode inverts the whole screen, so the ink is
-- inverted first and the pet keeps its own colours, as pictures do.
local inks_of = setmetatable({}, { __mode = "k" })

local function inks(palette)
    local colour, night = Screen:isColorEnabled() and true or false, Screen.night_mode and true or false
    local hit = inks_of[palette]
    if hit and hit.colour == colour and hit.night == night then return hit.inks, colour end
    local out = {}
    for ch, entry in pairs(palette) do
        if colour then
            local rgb = entry[1]
            local r, g, b = bit.rshift(rgb, 16), bit.band(bit.rshift(rgb, 8), 0xFF), bit.band(rgb, 0xFF)
            if night then r, g, b = 255 - r, 255 - g, 255 - b end
            out[ch] = Blitbuffer.ColorRGB32(r, g, b, 0xFF)
        else
            out[ch] = Blitbuffer.Color8(night and 255 - entry[2] or entry[2])
        end
    end
    inks_of[palette] = { colour = colour, night = night, inks = out }
    return out, colour
end

local SpriteWidget = Widget:extend{ rows = nil, palette = nil, k = 1 }

function SpriteWidget:getSize()
    return self.dimen
end

function SpriteWidget:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local k = self.k
    local ink_of, colour = inks(self.palette)
    for _i, run in ipairs(runs(self.rows)) do
        local ink = ink_of[run[4]]
        if ink then
            local top, left = edge(run[1], k), edge(run[2], k)
            local w, h = edge(run[3], k) - left, edge(run[1] + 1, k) - top
            if colour then
                bb:paintRectRGB32(x + left, y + top, w, h, ink)
            else
                bb:paintRect(x + left, y + top, w, h, ink)
            end
        end
    end
end

-- A sprite of character rows at scale k (whole or half steps), inked from a
-- palette of { colour, grey } per character (see bookorbit_pets).
function BoardArt.sprite(rows, k, palette)
    return SpriteWidget:new{ rows = rows, k = k, palette = palette,
        dimen = Geom:new{ w = edge(#rows[1], k), h = edge(#rows, k) } }
end

-- ---------------------------------------------------------------- glyphs
local font_paths = {}

local function fontPath(file)
    if font_paths[file] ~= nil then return font_paths[file] or nil end
    local found = false
    local ok, FontList = pcall(require, "fontlist")
    if ok and FontList then
        local escaped = file:gsub("[%-%.]", "%%%0")
        for _i, path in ipairs(FontList:getFontList() or {}) do
            if path:find(escaped .. "$") then
                found = path
                break
            end
        end
    end
    font_paths[file] = found
    return found or nil
end

function BoardArt.hasFont(file)
    return fontPath(file) ~= nil
end

local glyph_cache, glyph_order = {}, {}

local function renderGlyph(file, codepoint, size)
    local key = file .. "|" .. codepoint .. "|" .. size
    local hit = glyph_cache[key]
    if hit then return hit end
    local path = fontPath(file)
    if not path then return nil end
    local Freetype = require("ffi/freetype")
    local ok, ftsize = pcall(Freetype.newFaceSize, path, size)
    if not ok or not ftsize then return nil end
    -- A font without the character would draw its empty box instead.
    local has_ok, has = pcall(ftsize.hasGlyph, ftsize, codepoint)
    if not has_ok or not has then
        pcall(ftsize.done, ftsize)
        return nil
    end
    local rok, glyph = pcall(ftsize.renderGlyph, ftsize, codepoint)
    pcall(ftsize.done, ftsize)
    if not rok or not glyph or not glyph.bb then return nil end
    glyph_cache[key] = glyph
    table.insert(glyph_order, key)
    while #glyph_order > 16 do
        local old = table.remove(glyph_order, 1)
        local entry = glyph_cache[old]
        if entry and entry.bb then entry.bb:free() end
        glyph_cache[old] = nil
    end
    return glyph
end

-- Looks its glyph up again when painted: the cache may have let it go since.
local GlyphWidget = Widget:extend{ file = nil, codepoint = nil, size = nil, color = nil }

function GlyphWidget:getSize()
    return self.dimen
end

function GlyphWidget:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local g = renderGlyph(self.file, self.codepoint, self.size)
    if not g then return end
    local color = self.color or Blitbuffer.COLOR_BLACK
    -- The plain colour blit keeps only gray; an RGB colour takes the RGB one.
    if Blitbuffer.isColor8 and not Blitbuffer.isColor8(color) and bb.colorblitFromRGB32 then
        bb:colorblitFromRGB32(g.bb, x, y, 0, 0, g.bb:getWidth(), g.bb:getHeight(), color)
    else
        bb:colorblitFrom(g.bb, x, y, 0, 0, g.bb:getWidth(), g.bb:getHeight(), color)
    end
end

-- One character's bitmap at a pixel size: { bb, l, t }, or nil. Drawn by
-- callers that clip it themselves (the odometer's turning wheel). Look it up
-- again at paint time rather than keeping it.
BoardArt.glyphBitmap = renderGlyph

-- The ink of one character, as large as fits max_w x max_h. Nil when the
-- font is not on this device or has no such character.
function BoardArt.glyph(file, codepoint, max_w, max_h)
    if max_w < 1 or max_h < 1 then return nil end
    local probe_size = 200
    local probe = renderGlyph(file, codepoint, probe_size)
    if not probe then return nil end
    local pw, ph = probe.bb:getWidth(), probe.bb:getHeight()
    if pw < 1 or ph < 1 then return nil end
    local size = math.max(4, math.floor(probe_size * math.min(max_w / pw, max_h / ph)))
    local glyph = renderGlyph(file, codepoint, size)
    -- Rounding in the outline can overshoot by a pixel or two.
    while glyph and size > 4 and (glyph.bb:getWidth() > max_w or glyph.bb:getHeight() > max_h) do
        size = size - 1
        glyph = renderGlyph(file, codepoint, size)
    end
    if not glyph then return nil end
    return GlyphWidget:new{ file = file, codepoint = codepoint, size = size,
        dimen = Geom:new{ w = glyph.bb:getWidth(), h = glyph.bb:getHeight() } }
end

return BoardArt
