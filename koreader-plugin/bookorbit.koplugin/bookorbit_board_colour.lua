--[[--
Colour for the widget board on colour screens.

The Colour setting chooses how much of the board is coloured:
  accents  the default. Each widget's marks (bars, dots, chart cells, the
           switched-on control, its header icon) take the widget's own
           colour, and Continue reading takes the deep shade of its cover.
  tinted   accents, with every tile washed in its widget's colour; the
           tile style draws the edge in that colour, and the black clock
           and moon tiles take the deep shade.
  off      the sixteen greys.
Black-and-white screens always draw the greys: every colour here is asked
for together with the grey it replaces.

Text stays black or white and controls stay black, so nothing depends on
colour to be read. Kaleido 3 shows colour at half the resolution of black
and about half its saturation, so a colour e-reader gets every shade with its
chroma pushed out (KOReader's highlight colours are fully saturated for the
same reason) and icons drawn a third heavier. Night mode inverts the screen,
so each colour is painted with its hue turned half way round: it shows in its
own hue at the inverse lightness.
]]

local Colour = {}

Colour.SCHEMES = { "accents", "tinted", "off" }
Colour.DEFAULT = "accents"

-- ink: bars, dots, icons. deep: a filled tile with white text on it.
-- tint: tracks and pale marks. wash: a whole tile's background.
local FAM = {
    red = { ink = "#de4127", deep = "#8c2716", tint = "#f8c9bd", wash = "#fbdcd3" },
    orange = { ink = "#ee8410", deep = "#8a4806", tint = "#fbd6a6", wash = "#fde5c6" },
    gold = { ink = "#d9a40c", deep = "#6b5006", tint = "#f6e3a0", wash = "#faedc2" },
    green = { ink = "#1e9857", deep = "#135a37", tint = "#c2e8d1", wash = "#d9f1e2" },
    teal = { ink = "#12908b", deep = "#0c5653", tint = "#bfe6e3", wash = "#d7f0ee" },
    blue = { ink = "#2b61d6", deep = "#1b397d", tint = "#c8d7f6", wash = "#dde6f9" },
    violet = { ink = "#7848c8", deep = "#45277c", tint = "#dbcff2", wash = "#e8e0f7" },
    rose = { ink = "#d0386f", deep = "#801f46", tint = "#f4c8d8", wash = "#f8dbe5" },
    brown = { ink = "#99602f", deep = "#57381c", tint = "#e8d3bf", wash = "#f1e4d7" },
    yellow = { ink = "#e9b800", deep = "#6b5500", tint = "#f9e57f", wash = "#fcefae" },
    night = { ink = "#7f8bd6", deep = "#1c2147", tint = "#c9cdee", wash = "#dfe1f5" },
}
Colour.FAM = FAM

-- Which family each widget wears. Tiles that touch on a starter page, on any
-- screen, never share a family or a look-alike wash (gold beside yellow, red
-- beside rose, green beside teal); a dark ink tile may sit beside a pale tile
-- of its own family.
local HUE = {
    hero = "cover", also = "blue", streak = "orange", week = "green", today = "green", goalpace = "rose",
    toggles = "violet", highlight = "yellow", heatmap = "green", forecast = "blue", hours = "violet", records = "gold",
    yearago = "blue", word = "rose", sync = "orange", clock = "blue", light = "gold", calendar = "red",
    buddy = "violet", analog = "blue", moon = "night", odometer = "red", glyph = "red", rings = "brown",
    chapters = "cover", badge = "violet", dust = "green",
    ["link:library"] = "orange", ["link:authors"] = "rose", ["link:series"] = "violet", ["link:device"] = "gold",
    ["link:collections"] = "orange", ["link:scopes"] = "teal", ["link:search"] = "blue",
    ["shelf:random"] = "brown", ["shelf:recently-added"] = "teal", ["shelf:pick-back-up"] = "gold",
    ["shelf:up-next-in-series"] = "violet", ["shelf:want-to-read"] = "red", ["shelf:finished"] = "teal",
    ["shelf:in-progress"] = "blue",
}
Colour.HUE = HUE

local RARITY = { common = "green", rare = "blue", epic = "violet", legendary = "gold", ribbon = "red" }

-- -------------------------------------------------------------- colour math
local function hexRGB(hex)
    return tonumber(hex:sub(2, 3), 16), tonumber(hex:sub(4, 5), 16), tonumber(hex:sub(6, 7), 16)
end

local function clampByte(v)
    v = math.floor(v + 0.5)
    if v < 0 then return 0 end
    if v > 255 then return 255 end
    return v
end

local function rgbHex(r, g, b)
    return string.format("#%02x%02x%02x", clampByte(r), clampByte(g), clampByte(b))
end

function Colour.mix(a, b, t)
    local ar, ag, ab = hexRGB(a)
    local br, bg, bb = hexRGB(b)
    return rgbHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
end

-- Hue, lightness, saturation in 0..1, as Python's colorsys has them.
local function rgbToHls(r, g, b)
    local maxc, minc = math.max(r, g, b), math.min(r, g, b)
    local l = (minc + maxc) / 2
    if maxc == minc then return 0, l, 0 end
    local s = l <= 0.5 and (maxc - minc) / (maxc + minc) or (maxc - minc) / (2 - maxc - minc)
    local rc, gc, bc = (maxc - r) / (maxc - minc), (maxc - g) / (maxc - minc), (maxc - b) / (maxc - minc)
    local h
    if r == maxc then h = bc - gc
    elseif g == maxc then h = 2 + rc - bc
    else h = 4 + gc - rc end
    return (h / 6) % 1, l, s
end
Colour.rgbToHls = rgbToHls

local function hueValue(m1, m2, hue)
    hue = hue % 1
    if hue < 1 / 6 then return m1 + (m2 - m1) * hue * 6 end
    if hue < 0.5 then return m2 end
    if hue < 2 / 3 then return m1 + (m2 - m1) * (2 / 3 - hue) * 6 end
    return m1
end

local function hlsToRgb(h, l, s)
    if s == 0 then return l, l, l end
    local m2 = l <= 0.5 and l * (1 + s) or l + s - l * s
    local m1 = 2 * l - m2
    return hueValue(m1, m2, h + 1 / 3), hueValue(m1, m2, h), hueValue(m1, m2, h - 1 / 3)
end

local function hlsHex(h, l, s)
    local r, g, b = hlsToRgb(h, l, s)
    return rgbHex(r * 255, g * 255, b * 255)
end

-- Chroma pushed out from the colour's own luma.
function Colour.boost(hex, k)
    local r, g, b = hexRGB(hex)
    local y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return rgbHex(y + (r - y) * k, y + (g - y) * k, y + (b - y) * k)
end

-- What to paint so the inverted screen shows `hex`'s hue at the inverse
-- lightness: the same lightness and saturation, the hue turned half way.
function Colour.forNight(hex)
    local r, g, b = hexRGB(hex)
    local h, l, s = rgbToHls(r / 255, g / 255, b / 255)
    return hlsHex(h + 0.5, l, s)
end

-- ----------------------------------------------------------- cover colours
-- One family per cover: pixels that are nearly grey, nearly black or nearly
-- white are dropped and the rest vote by hue, weighted by saturation. The
-- winning hue gives the deep, ink and tint shades. A jacket with too few
-- coloured pixels has none. pixels: a list of { r, g, b } in 0..255.
function Colour.familyFromPixels(pixels)
    local BINS = 36
    local bins, sats = {}, {}
    for i = 0, BINS - 1 do bins[i], sats[i] = 0, {} end
    local total = #pixels
    if total == 0 then return nil end
    for _i, p in ipairs(pixels) do
        local h, l, s = rgbToHls(p[1] / 255, p[2] / 255, p[3] / 255)
        if s >= 0.28 and l >= 0.12 and l <= 0.9 then
            local k = math.floor(h * BINS) % BINS
            bins[k] = bins[k] + s * (1 - math.abs(l - 0.5))
            table.insert(sats[k], s)
        end
    end
    -- Neighbouring bins vote together, so a hue split across a bin edge wins.
    local best, best_v = 0, -1
    for i = 0, BINS - 1 do
        local v = bins[(i - 1) % BINS] * 0.5 + bins[i] + bins[(i + 1) % BINS] * 0.5
        if v > best_v then best, best_v = i, v end
    end
    if best_v / total < 0.06 then return nil end
    local hue = (best + 0.5) / BINS
    local list = sats[best]
    table.sort(list)
    local sat = #list > 0 and list[math.floor(#list / 2) + 1] or 0.5
    local tint = hlsHex(hue, 0.85, 0.7)
    return {
        deep = hlsHex(hue, 0.22, math.min(0.7, math.max(0.4, sat))),
        ink = hlsHex(hue, 0.44, math.min(0.85, math.max(0.6, sat))),
        tint = tint,
        wash = Colour.mix(tint, "#ffffff", 0.45),
    }
end

local cover_cache, cover_count = {}, 0
local NO_COVER = false

-- The family of the cover at `path`, worked out once per cover and kept.
function Colour.coverFamily(path)
    if not path then return nil end
    local hit = cover_cache[path]
    if hit ~= nil then return hit or nil end
    local fam = nil
    local ok, bb = pcall(function() return require("ui/renderimage"):renderImageFile(path, false, 24, 36) end)
    if ok and bb then
        local pixels = {}
        for y = 0, bb:getHeight() - 1 do
            for x = 0, bb:getWidth() - 1 do
                local c = bb:getPixel(x, y):getColorRGB32()
                table.insert(pixels, { c.r, c.g, c.b })
            end
        end
        bb:free()
        fam = Colour.familyFromPixels(pixels)
    end
    if cover_count > 200 then cover_cache, cover_count = {}, 0 end
    cover_cache[path] = fam or NO_COVER
    cover_count = cover_count + 1
    return fam
end

-- ---------------------------------------------------------- the screen
-- Specs set Colour._env to { colour, eink, night } instead of a device.
local function env()
    if Colour._env then return Colour._env end
    local Device = require("device")
    local Screen = Device.screen
    local Blitbuffer = require("ffi/blitbuffer")
    return {
        -- Older KOReader builds cannot paint RGB fills and borders.
        colour = Screen:isColorEnabled() and Blitbuffer.isColor8 ~= nil and Blitbuffer.ColorRGB32 ~= nil,
        eink = Device:hasEinkScreen() and true or false,
        night = Screen.night_mode and true or false,
    }
end
Colour.env = env

function Colour.normalize(value)
    for _i, s in ipairs(Colour.SCHEMES) do
        if s == value then return value end
    end
    return Colour.DEFAULT
end

function Colour.scheme(ctx)
    return ctx and ctx.colour or "off"
end

-- Colour reaches only screens that show it.
function Colour.on(ctx)
    return Colour.scheme(ctx) ~= "off" and env().colour == true
end

function Colour.tinted(ctx)
    return Colour.on(ctx) and ctx.colour == "tinted"
end

-- The key a tile's colour is looked up by.
function Colour.keyFor(type_, props)
    if type_ == "link" and props and props.link then return "link:" .. props.link end
    if type_ == "shelf" and props and props.source then return "shelf:" .. props.source end
    return type_
end

local boosted = {}
local function forPanel(fam)
    if not fam or not env().eink then return fam end
    local hit = boosted[fam]
    if hit then return hit end
    hit = {}
    for k, v in pairs(fam) do hit[k] = Colour.boost(v, 1.4) end
    boosted[fam] = hit
    return hit
end

local function leadCover(ctx)
    local book = ctx and ctx.d and ctx.d.continue_reading and ctx.d.continue_reading[1]
    return book and Colour.coverFamily(book.cover_path) or nil
end

-- The family for a widget key (the tile's own when nil) or a family name.
function Colour.fam(ctx, key)
    key = key or (ctx and ctx.tile_key)
    if key == "hero" or key == "chapters" then return forPanel(leadCover(ctx) or FAM.blue) end
    if FAM[key] then return forPanel(FAM[key]) end
    return forPanel(FAM[HUE[key] or "blue"])
end

function Colour.rarity(rarity)
    return forPanel(FAM[RARITY[rarity] or "violet"])
end

-- -------------------------------------------------------- what is painted
local paint_cache = {}

-- A hex colour as the screen should be given it: night mode turns its hue.
function Colour.hex(hex)
    if env().night then return Colour.forNight(hex) end
    return hex
end

-- A hex colour as a Blitbuffer colour, one object per colour, so a tile's
-- chrome fingerprints the same way on every rebuild.
function Colour.paint(hex)
    hex = Colour.hex(hex)
    local hit = paint_cache[hex]
    if hit then return hit end
    local Blitbuffer = require("ffi/blitbuffer")
    local r, g, b = hexRGB(hex)
    hit = Blitbuffer.ColorRGB32(r, g, b, 0xFF)
    paint_cache[hex] = hit
    return hit
end

-- Each shade, or the grey given for a screen without colour.
function Colour.ink(ctx, grey, key)
    if not Colour.on(ctx) then return grey end
    return Colour.paint(Colour.fam(ctx, key).ink)
end

function Colour.deep(ctx, grey, key)
    if not Colour.on(ctx) then return grey end
    return Colour.paint(Colour.fam(ctx, key).deep)
end

function Colour.tint(ctx, grey, key)
    if not Colour.on(ctx) then return grey end
    return Colour.paint(Colour.fam(ctx, key).tint)
end

-- Between tint and ink: the other days beside today's full-colour bar.
function Colour.mid(ctx, grey, key)
    if not Colour.on(ctx) then return grey end
    local f = Colour.fam(ctx, key)
    return Colour.paint(Colour.mix(f.tint, f.ink, 0.45))
end

-- A bar's empty part: the pale shade on white, white on a washed tile.
function Colour.track(ctx, grey, key)
    if not Colour.on(ctx) then return grey end
    if Colour.tinted(ctx) then return Colour.paint("#ffffff") end
    return Colour.paint(Colour.fam(ctx, key).tint)
end

-- A five-step ramp from none to most (Year in reading).
function Colour.ramp(ctx, greys, key)
    if not Colour.on(ctx) then return greys end
    local f = Colour.fam(ctx, key)
    local empty = Colour.tinted(ctx) and Colour.paint(Colour.mix(f.wash, "#ffffff", 0.55)) or greys[1]
    return { empty, Colour.paint(f.tint), Colour.paint(Colour.mix(f.tint, f.ink, 0.5)), Colour.paint(f.ink), Colour.paint(f.deep) }
end

-- An icon's options: the widget's colour, heavier on a colour e-reader.
function Colour.icon(ctx, sw, key)
    if not Colour.on(ctx) then return { sw = sw } end
    return { sw = env().eink and math.floor(sw * 135 + 0.5) / 100 or sw, col = Colour.hex(Colour.fam(ctx, key).ink) }
end

-- A hex shade for SVG art, or the grey's hex.
function Colour.artHex(ctx, grey_hex, shade, key)
    if not Colour.on(ctx) then return grey_hex end
    return Colour.hex(Colour.fam(ctx, key)[shade or "ink"])
end

-- Ink tiles (Continue reading, the clocks, the moon) keep black in accents,
-- except Continue reading, which takes its cover's deep shade; tinted gives
-- every one its deep shade. A jacket without colour keeps black.
function Colour.inkFill(ctx, key)
    key = key or (ctx and ctx.tile_key)
    local Blitbuffer = require("ffi/blitbuffer")
    if not Colour.on(ctx) then return Blitbuffer.COLOR_BLACK end
    if key == "hero" then
        local lead = leadCover(ctx)
        return lead and Colour.paint(forPanel(lead).deep) or Blitbuffer.COLOR_BLACK
    end
    if Colour.tinted(ctx) then return Colour.paint(Colour.fam(ctx, key).deep) end
    return Blitbuffer.COLOR_BLACK
end

local function inkFillHex(ctx, key)
    if not Colour.on(ctx) then return nil end
    if key == "hero" then
        local lead = leadCover(ctx)
        return lead and forPanel(lead).deep or nil
    end
    return Colour.tinted(ctx) and Colour.fam(ctx, key).deep or nil
end

-- Quiet text on an ink tile: the grey on black, a pale shade on colour.
function Colour.onInk(ctx, grey, key)
    key = key or (ctx and ctx.tile_key)
    if not inkFillHex(ctx, key) then return grey end
    return Colour.paint(Colour.mix(Colour.fam(ctx, key).tint, "#ffffff", 0.35))
end

-- The same for an icon: an INK key on black, the pale shade's hex on colour.
function Colour.onInkHex(ctx, grey_key, key)
    key = key or (ctx and ctx.tile_key)
    if not inkFillHex(ctx, key) then return grey_key end
    return Colour.hex(Colour.mix(Colour.fam(ctx, key).tint, "#ffffff", 0.35))
end

-- A bar's track on an ink tile.
function Colour.inkTrack(ctx, grey, key)
    key = key or (ctx and ctx.tile_key)
    local fill = inkFillHex(ctx, key)
    return fill and Colour.paint(Colour.mix(fill, "#ffffff", 0.3)) or grey
end

-- Tile chrome. base is the tile style's own; tinted keeps its edge, drawn in
-- the widget's colour: Outline a hairline a step darker than the wash, Soft no
-- edge, Ink a firm edge in the deep shade. Highlight of the day is yellow,
-- the colour KOReader highlights in, in both schemes.
function Colour.chrome(ctx, chrome, key, base, hairline, firm)
    if not Colour.on(ctx) or chrome == "open" then return base end
    local out = {}
    for k, v in pairs(base) do out[k] = v end
    if chrome == "ink" then
        out.bg = Colour.inkFill(ctx, key)
        return out
    end
    local tinted = Colour.tinted(ctx)
    if not tinted and key ~= "highlight" then return base end
    local f = Colour.fam(ctx, key)
    out.bg = Colour.paint(f.wash)
    out.border, out.border_col = 0, nil
    if tinted then
        local tiles = ctx.tiles or "outline"
        if tiles == "outline" then
            out.border, out.border_col = hairline, Colour.paint(Colour.mix(f.wash, f.ink, 0.4))
        elseif tiles == "ink" then
            out.border, out.border_col = firm, Colour.paint(f.deep)
        end
    end
    return out
end

-- Whatever sits on a tile and assumed white or grey (the halo between fanned
-- covers, a cover's hairline) takes the tile's own colour on a washed tile.
function Colour.halo(ctx, grey)
    if not Colour.tinted(ctx) then return grey end
    return Colour.paint(Colour.fam(ctx).wash)
end

function Colour.coverEdge(ctx, grey)
    if not Colour.tinted(ctx) then return grey end
    local f = Colour.fam(ctx)
    return Colour.paint(Colour.mix(f.wash, f.deep, 0.3))
end

function Colour.clearCache()
    cover_cache, cover_count, boosted, paint_cache = {}, 0, {}, {}
end

return Colour
