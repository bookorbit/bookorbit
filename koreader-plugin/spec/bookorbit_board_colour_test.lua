package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BLACK = { grey = 0 }
package.loaded["ffi/blitbuffer"] = {
    COLOR_BLACK = BLACK,
    ColorRGB32 = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end,
    isColor8 = function(c) return c.grey ~= nil end,
}
package.loaded["gettext"] = function(value) return value end
local pixels_of = {}
package.loaded["ui/renderimage"] = {
    renderImageFile = function(_self, path)
        local list = pixels_of[path]
        if not list then return nil end
        return {
            getWidth = function() return #list end,
            getHeight = function() return 1 end,
            getPixel = function(_bb, x)
                local p = list[x + 1]
                return { getColorRGB32 = function() return { r = p[1], g = p[2], b = p[3] } end }
            end,
            free = function() end,
        }
    end,
}

local Colour = require("bookorbit_board_colour")
local Layout = require("bookorbit_board_layout")
local Store = require("bookorbit_board_store")

local function hex(c) return string.format("#%02x%02x%02x", c.r, c.g, c.b) end
local function rgb(s) return tonumber(s:sub(2, 3), 16), tonumber(s:sub(4, 5), 16), tonumber(s:sub(6, 7), 16) end
local function chroma(s)
    local r, g, b = rgb(s)
    return math.max(r, g, b) - math.min(r, g, b)
end
local function luma(s)
    local r, g, b = rgb(s)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
end

-- Colour math.
assert(Colour.mix("#000000", "#ffffff", 0.5) == "#808080", "mix halves")
assert(Colour.boost("#777777", 1.4) == "#777777", "boost leaves a gray alone")
assert(chroma(Colour.boost("#2b61d6", 1.4)) > chroma("#2b61d6"), "boost pushes chroma out")
assert(math.abs(luma(Colour.boost("#2b61d6", 1.4)) - luma("#2b61d6")) < 3, "boost keeps luma")
assert(Colour.forNight("#808080") == "#808080", "night leaves a gray alone")
do
    -- Inverting what is painted for night shows the colour's own hue.
    local painted = Colour.forNight("#de4127")
    local r, g, b = rgb(painted)
    local hn = Colour.rgbToHls((255 - r) / 255, (255 - g) / 255, (255 - b) / 255)
    local r0, g0, b0 = rgb("#de4127")
    local h0, l0 = Colour.rgbToHls(r0 / 255, g0 / 255, b0 / 255)
    local _, lp = Colour.rgbToHls(r / 255, g / 255, b / 255)
    assert(math.abs(hn - h0) < 0.01, "night shows the same hue")
    assert(math.abs(lp - l0) < 0.01, "night paints at the same lightness")
end

-- Cover families.
local function fill(n, p) local t = {} for i = 1, n do t[i] = p end return t end
assert(Colour.familyFromPixels(fill(100, { 128, 128, 128 })) == nil, "a gray jacket has no colour")
assert(Colour.familyFromPixels(fill(100, { 250, 250, 250 })) == nil, "a white jacket has no colour")
do
    local mostly_gray = fill(97, { 30, 30, 30 })
    for _i = 1, 3 do table.insert(mostly_gray, { 40, 90, 200 }) end
    assert(Colour.familyFromPixels(mostly_gray) == nil, "a few coloured pixels are not enough")
    local blue = fill(60, { 40, 90, 200 })
    for _i = 1, 40 do table.insert(blue, { 20, 20, 20 }) end
    local fam = Colour.familyFromPixels(blue)
    assert(fam, "a blue jacket has a family")
    assert(luma(fam.deep) < luma(fam.ink) and luma(fam.ink) < luma(fam.tint) and luma(fam.tint) < luma(fam.wash), "deep, ink, tint, wash get lighter")
    local r, g, b = rgb(fam.ink)
    assert(b > r and b > g, "the family keeps the jacket's hue")
    -- Deep carries white text.
    assert(luma(fam.deep) < 80, "deep is dark enough for white text")
end
pixels_of["/covers/ocean.jpg"] = fill(50, { 30, 120, 160 })
pixels_of["/covers/plain.jpg"] = fill(50, { 200, 200, 200 })
assert(Colour.coverFamily("/covers/ocean.jpg"), "a cover file gives its family")
pixels_of["/covers/ocean.jpg"] = nil
assert(Colour.coverFamily("/covers/ocean.jpg"), "a cover's family is kept")
assert(Colour.coverFamily("/covers/plain.jpg") == nil and Colour.coverFamily("/covers/plain.jpg") == nil, "no family, asked twice")
assert(Colour.coverFamily(nil) == nil, "no path, no family")

-- What reaches the screen.
local GREY = { grey = 136 }
local function ctx(scheme, extra)
    local c = { colour = scheme, tiles = "outline", d = { continue_reading = { { cover_path = "/covers/ocean.jpg" } } } }
    for k, v in pairs(extra or {}) do c[k] = v end
    return c
end
local LCD, EINK = { colour = true, eink = false, night = false }, { colour = true, eink = true, night = false }
local MONO = { colour = false, eink = true, night = false }

Colour._env = MONO
for _, scheme in ipairs(Colour.SCHEMES) do
    local c = ctx(scheme, { tile_key = "streak" })
    assert(Colour.ink(c, GREY) == GREY and Colour.track(c, GREY) == GREY and Colour.mid(c, GREY) == GREY, scheme .. ": a black-and-white screen keeps its grays")
    assert(Colour.inkFill(c, "hero") == BLACK, scheme .. ": Continue reading stays black there")
    local base = { bg = GREY, border = 1, border_col = GREY }
    assert(Colour.chrome(c, "line", "highlight", base, 1, 2) == base, scheme .. ": tiles unchanged there")
    assert(Colour.icon(c, 2.25).col == nil and Colour.icon(c, 2.25).sw == 2.25, scheme .. ": icons unchanged there")
end

Colour._env = LCD
do
    local off = ctx("off", { tile_key = "streak" })
    assert(Colour.ink(off, GREY) == GREY, "Off keeps the grays on a colour screen")
    local acc = ctx("accents", { tile_key = "streak" })
    assert(hex(Colour.ink(acc, GREY)) == Colour.FAM.orange.ink, "Streak is orange")
    assert(hex(Colour.track(acc, GREY)) == Colour.FAM.orange.tint, "a bar runs on its own tint")
    assert(Colour.paint("#123456") == Colour.paint("#123456"), "one object per colour")
    assert(Colour.icon(acc, 2.25).sw == 2.25, "a phone keeps icon weights")
    -- Accents: tiles as they are, the highlight yellow, Continue reading in its cover.
    local base = { bg = GREY, border = 1, border_col = GREY, radius = 4 }
    assert(Colour.chrome(acc, "line", "streak", base, 1, 2) == base, "Accents keeps a tile's own chrome")
    local hl = Colour.chrome(acc, "fill", "highlight", base, 1, 2)
    assert(hex(hl.bg) == Colour.FAM.yellow.wash and hl.border == 0 and hl.radius == 4, "Highlight of the day is a yellow card")
    local lead = Colour.coverFamily("/covers/ocean.jpg")
    assert(hex(Colour.chrome(acc, "ink", "hero", base, 1, 2).bg) == lead.deep, "Continue reading takes its cover's deep shade")
    assert(Colour.chrome(acc, "ink", "clock", base, 1, 2).bg == BLACK, "the clock stays black in Accents")
    assert(Colour.chrome(acc, "ink", "moon", base, 1, 2).bg == BLACK, "the moon stays black in Accents")
    assert(Colour.onInk(acc, GREY, "clock") == GREY, "quiet text on black stays gray")
    assert(Colour.onInk(acc, GREY, "hero") ~= GREY, "quiet text on the cover's shade takes a pale shade")
    local plain = ctx("accents", { d = { continue_reading = { { cover_path = "/covers/plain.jpg" } } } })
    assert(Colour.inkFill(plain, "hero") == BLACK, "a jacket without colour keeps the black tile")
    -- Tinted: the wash, with the tile style's edge in the widget's colour.
    local outline = ctx("tinted", { tile_key = "week" })
    local ch = Colour.chrome(outline, "line", "week", base, 1, 2)
    assert(hex(ch.bg) == Colour.FAM.green.wash and ch.border == 1 and hex(ch.border_col) == Colour.mix(Colour.FAM.green.wash, Colour.FAM.green.ink, 0.4), "Outline: wash and a hairline")
    local soft = Colour.chrome(ctx("tinted", { tiles = "soft" }), "line", "week", base, 1, 2)
    assert(hex(soft.bg) == Colour.FAM.green.wash and soft.border == 0, "Soft: the wash alone")
    local ink = Colour.chrome(ctx("tinted", { tiles = "ink" }), "line", "week", base, 1, 2)
    assert(ink.border == 2 and hex(ink.border_col) == Colour.FAM.green.deep, "Ink: a firm deep edge")
    assert(hex(Colour.chrome(outline, "ink", "clock", base, 1, 2).bg) == Colour.FAM.blue.deep, "the clock goes deep blue when tinted")
    assert(hex(Colour.track(outline, GREY)) == "#ffffff", "bars run on white in a washed tile")
    assert(hex(Colour.halo(outline, GREY)) == Colour.FAM.green.wash, "fanned covers sit in the wash")
    assert(Colour.halo(acc, GREY) == GREY, "and keep their white halo on white tiles")
    assert(Colour.chrome(outline, "open", "week", base, 1, 2) == base, "open tiles stay open")
end

Colour._env = EINK
do
    local acc = ctx("accents", { tile_key = "streak" })
    local ink = hex(Colour.ink(acc, GREY))
    assert(ink == Colour.boost(Colour.FAM.orange.ink, 1.4), "a colour e-reader gets the boosted shade")
    assert(Colour.icon(acc, 2.25).sw > 2.25, "and heavier icons")
end

Colour._env = { colour = true, eink = false, night = true }
do
    local acc = ctx("accents", { tile_key = "streak" })
    assert(hex(Colour.ink(acc, GREY)) == Colour.forNight(Colour.FAM.orange.ink), "night mode paints the turned hue")
    assert(Colour.icon(acc, 2.25).col == Colour.forNight(Colour.FAM.orange.ink), "icons too")
end
Colour._env = nil

-- The setting.
assert(Store.read({}).colour == "accents", "Accents by default")
assert(Store.read({ catalog_board = { version = 1, colour = "loud" } }).colour == "accents", "an unknown value reads as Accents")
assert(Store.withColour({}, "tinted").colour == "tinted", "Tinted is kept")
assert(Store.withColour({ catalog_board = { version = 1, tiles = "ink", colour = "tinted" } }, "off").tiles == "ink", "changing colour keeps the tile style")
assert(Colour.normalize(nil) == "accents" and Colour.normalize("off") == "off", "normalize")

-- No two touching tiles on a starter page share a colour or a look-alike
-- wash, on any screen; a dark ink tile may touch a pale one of its family.
local FIXED = { highlight = true, hero = true, chapters = true, clock = true, analog = true, moon = true }
local ALIKE = { gold = "yellow", yellow = "gold", rose = "red", red = "rose", teal = "green", green = "teal" }
local function clash(a, b) return a == b or ALIKE[a] == b end
for _, cols in ipairs({ 2, 4, 6 }) do
    for _, landscape in ipairs({ false, true }) do
        for _, has_light in ipairs({ true, false }) do
        for _, page in ipairs(Store.starterPages(cols, "reader", has_light, landscape)) do
            local packed = Layout.pack(page.base, cols)
            local at = {}
            for _, it in ipairs(packed.placed) do
                for y = it.y, it.y + it.rh - 1 do
                    for x = it.x, it.x + it.cw - 1 do
                        at[y .. ":" .. x] = it
                    end
                end
            end
            local function fam(it)
                local key = Colour.keyFor(it.type, it.props)
                return Colour.HUE[key]
            end
            for _, it in ipairs(packed.placed) do
                for y = it.y, it.y + it.rh - 1 do
                    for _, other in ipairs({ at[y .. ":" .. (it.x + it.cw)] }) do
                        if other and other ~= it and not FIXED[it.type] and not FIXED[other.type] then
                            assert(not clash(fam(it), fam(other)), string.format("%d cols%s %s: %s beside %s", cols, landscape and " landscape" or "", page.id, it.type, other.type))
                        end
                    end
                end
                for x = it.x, it.x + it.cw - 1 do
                    local other = at[(it.y + it.rh) .. ":" .. x]
                    if other and other ~= it and not FIXED[it.type] and not FIXED[other.type] then
                        assert(not clash(fam(it), fam(other)), string.format("%d cols%s %s: %s above %s", cols, landscape and " landscape" or "", page.id, it.type, other.type))
                    end
                end
            end
        end
        end
    end
end

print("bookorbit_board_colour_test: ok")
