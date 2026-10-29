package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local widget = {}
function widget:extend(options)
    return setmetatable(options or {}, { __index = self })
end
function widget:new(options) return self:extend(options) end
for _, name in ipairs({ "ui/widget/widget", "ui/widget/container/centercontainer", "ui/geometry" }) do
    package.loaded[name] = widget
end
for _, name in ipairs({ "ui/font", "ui/widget/textwidget", "ui/renderimage", "logger", "bookorbit_board_icons", "bookorbit_board_ui" }) do
    package.loaded[name] = {}
end
local colour_screen = false
local screen = { isColorEnabled = function() return colour_screen end, night_mode = false }
package.loaded["device"] = { screen = screen }
package.loaded["ffi/blitbuffer"] = {
    Color8 = function(v) return { grey = v } end,
    ColorRGB32 = function(r, g, b, a) return { r = r, g = g, b = b, a = a } end,
}
package.loaded["bookorbit_board_metrics"] = {
    INK = { black = 0, g4 = 68, g5 = 85, g9 = 153, gc = 204, white = 255 },
}
package.loaded["bookorbit_board_data"] = { formatDuration = function() return "30 min" end }
package.loaded["gettext"] = function(value) return value end
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["ui/uimanager"] = {}
package.loaded["ui/widget/infomessage"] = widget

local Art = require("bookorbit_board_art")
local Decor = require("bookorbit_board_decor")
local Edit = require("bookorbit_board_edit")
local Store = require("bookorbit_board_store")
local poses = { "read", "sleep", "party", "ribbon", "yawn", "wait" }

-- Every generated module is a known pet and every known pet has a module.
local listed = {}
for name in io.popen("ls koreader-plugin/bookorbit.koplugin/bookorbit_pets"):lines() do
    listed[name:gsub("%.lua$", "")] = true
end
for _, name in ipairs(Decor.PETS) do
    assert(listed[name], name .. " has a generated module")
    listed[name] = nil
end
assert(next(listed) == nil, "no module for an unknown pet: " .. tostring(next(listed)))

for _, name in ipairs(Decor.PETS) do
    local pet = Decor.pet(name)
    local count = 0
    for ch, entry in pairs(pet.palette) do
        count = count + 1
        assert(#ch == 1 and ch ~= " ", name .. " palette characters")
        assert(entry[1] >= 0 and entry[1] <= 0xFFFFFF and entry[1] % 1 == 0, name .. " colours")
        assert(entry[2] >= 0 and entry[2] <= 255 and entry[2] % 17 == 0, name .. " greys are e-ink levels")
    end
    assert(count <= 90, name .. " palette size")
    local seen = {}
    for _, pose in ipairs(poses) do
        local rows = pet[pose]
        assert(#rows == 64, name .. "/" .. pose .. " height")
        local signature = table.concat(rows)
        assert(not seen[signature], name .. " must have six distinct poses")
        seen[signature] = true
        for _, row in ipairs(rows) do
            assert(#row == 64, name .. "/" .. pose .. " width")
            for x = 1, #row do
                local ch = row:sub(x, x)
                assert(ch == " " or pet.palette[ch], name .. "/" .. pose .. " uses only its palette")
            end
        end
    end
end
assert(Decor.pet("unknown") == Decor.pet("cat") and Decor.pet(nil) == Decor.pet("cat"), "unknown pets show the cat")

-- Exercise the actual rectangle renderer at whole and half steps, including
-- transparent cells and offsets: every pixel belongs to exactly its cell.
local function edge(i, k) return math.floor(i * k + 1e-6) end
local function paint(rows, palette, k)
    local pixels = {}
    local function fill(_, x, y, w, h, ink)
        assert(x % 1 == 0 and y % 1 == 0 and w % 1 == 0 and h % 1 == 0, "integer pixel edges")
        assert(w > 0 and h > 0, "no empty rectangles")
        assert(x >= 7 and y >= 11 and x + w <= 7 + edge(64, k) and y + h <= 11 + edge(64, k), "no overflow")
        for yy = y, y + h - 1 do
            for xx = x, x + w - 1 do pixels[yy * 1000 + xx] = ink end
        end
    end
    local sprite = Art.sprite(rows, k, palette)
    assert(sprite:getSize().w == edge(64, k) and sprite:getSize().h == edge(64, k))
    sprite:paintTo({ paintRect = fill, paintRectRGB32 = fill }, 7, 11)
    return pixels
end
local function check(rows, palette, k, expect)
    local pixels = paint(rows, palette, k)
    for y, row in ipairs(rows) do
        for x = 1, #row do
            local ch = row:sub(x, x)
            for py = edge(y - 1, k), edge(y, k) - 1 do
                for px = edge(x - 1, k), edge(x, k) - 1 do
                    local got = pixels[(11 + py) * 1000 + 7 + px]
                    if ch == " " then
                        assert(got == nil, "transparent cells stay unpainted")
                    else
                        assert(got and expect(palette[ch], got), "paints the authored cell exactly")
                    end
                end
            end
        end
    end
end
local function greyOf(entry, ink) return ink.grey == entry[2] end
for _, name in ipairs(Decor.PETS) do
    local pet = Decor.pet(name)
    for _, pose in ipairs(poses) do
        for _, k in ipairs({ 1, 1.5 }) do check(pet[pose], pet.palette, k, greyOf) end
    end
end
local cat = Decor.pet("cat")
for _, k in ipairs({ 2, 2.5, 3 }) do check(cat.read, cat.palette, k, greyOf) end

colour_screen = true
check(cat.party, cat.palette, 1.5, function(entry, ink)
    return ink.r * 65536 + ink.g * 256 + ink.b == entry[1] and ink.a == 255
end)
screen.night_mode = true
check(cat.party, cat.palette, 2, function(entry, ink)
    return (255 - ink.r) * 65536 + (255 - ink.g) * 256 + (255 - ink.b) == entry[1]
end)
colour_screen = false
check(cat.party, cat.palette, 2, function(entry, ink) return ink.grey == 255 - entry[2] end)
screen.night_mode = false
check(cat.party, cat.palette, 2, greyOf)

local noon = os.time({ year = 2026, month = 10, day = 17, hour = 12 })
local d = { now = noon, continue_reading = {}, streak = { current = 0 } }
assert(Decor.buddyPose(d) == "wait")
d.continue_reading = { { id = 1 } }
assert(Decor.buddyPose(d) == "sleep")
d.today_min = 30
d.streak = { current = 3, longest = 20 }
assert(Decor.buddyPose(d) == "read")
d.now = os.time({ year = 2026, month = 10, day = 17, hour = 23 })
assert(Decor.buddyPose(d) == "yawn")
d.streak.current = 7
assert(Decor.buddyPose(d) == "party")
d.finished_today = { title = "Finished book" }
assert(Decor.buddyPose(d) == "ribbon")

-- Gallery identity and persistence distinguish companions of the same widget type.
assert(Edit.entryFor({ type = "buddy" }).props == nil, "existing buddies remain cats")
for _, animal in ipairs(Decor.PETS) do
    if animal ~= "cat" then
        local entry = Edit.entryFor({ type = "buddy", props = { animal = animal } })
        assert(entry and entry.props.animal == animal, "the editor identifies " .. animal)
        assert(entry.tab == "decor" and table.concat(entry.sizes, ",") == "L,M,S")
        local catalog = {
            settings = {}, board_edit = { pages = { { items = {} } } },
            boardGeometry = function() return { cols = 4 } end,
            boardPage = function() return 1 end,
            boardPageFits = function() return true end,
            updateItems = function() end,
        }
        Edit.boardEditRun(catalog, { kind = "sheet-add", entry = entry })
        local item = catalog.board_edit.pages[1].items[1]
        assert(item.props.animal == animal and item.props ~= entry.props, "adding copies the selected animal")
        catalog.settings[Store.SETTING_KEY] = Store.withCustomPages({}, 4, catalog.board_edit.pages)
        local pages = Store.pages(catalog.settings, 4, true)
        assert(pages[1].base[1].props.animal == animal, "saved animal survives reload")
    end
end

-- Capture the sprite selected by the production widget without a font dependency.
local UI = package.loaded["bookorbit_board_ui"]
UI.text = function() return {} end
UI.space = function() return {} end
UI.flex = function() return {} end
UI.vstack = function() return {} end
UI.pick = function(variants) return variants[#variants]() end
local metrics = package.loaded["bookorbit_board_metrics"]
metrics.px = function(value) return value end
metrics.lh1 = function() return 12 end
local selected, selected_palette, selected_scale
local real_sprite = Art.sprite
Art.sprite = function(rows, scale, palette)
    selected, selected_palette, selected_scale = rows, palette, scale
    assert(scale * 2 == math.floor(scale * 2) and scale >= 1, "whole or half steps")
    assert(edge(#rows[1], scale) <= 136 and edge(#rows, scale) <= 136, "small tile fits")
    return {}
end
package.loaded["bookorbit_board_decor"] = nil
Decor = require("bookorbit_board_decor")
local companions = { "unknown" }
for _, animal in ipairs(Decor.PETS) do table.insert(companions, animal) end
for _, animal in ipairs(companions) do
    Decor.buddy({ d = d }, 160, 160, { animal = animal })
    local pet = Decor.pet(animal)
    assert(selected == pet.ribbon and selected_palette == pet.palette, "selected companion or safe cat fallback")
end
Decor.buddy({ d = d }, 160, 160)
assert(selected == Decor.pet("cat").ribbon, "legacy widget still renders the cat")
-- 104 px across holds 1.625 cells per pixel: a half step, not 1x.
Decor.buddy({ d = d }, 128, 128, { animal = "witch" })
assert(selected_scale == 1.5, "half steps fill tiles between whole sizes")
Art.sprite = real_sprite

-- A gallery page must not reuse the cat's cached picture for another character.
for _, name in ipairs({ "ui/event", "ui/gesturerange", "ui/widget/container/inputcontainer", "ui/widget/verticalspan" }) do
    package.loaded[name] = widget
end
package.loaded["ui/network/manager"] = {}
package.loaded["bookorbit_catalog_widgets"] = {}
local rendered, snapshots = {}, {}
package.loaded["bookorbit_board_widgets"] = { tile = function(_, item)
    local animal = item.props and item.props.animal or "cat"
    rendered[animal] = (rendered[animal] or 0) + 1
    return { animal = animal }
end }
UI.snapshot = function(key, _, _, _, _, render)
    if not snapshots[key] then snapshots[key] = render() end
    return snapshots[key]
end
UI.box = function(_, child) return child end
UI.hstack = function(_, children) return children[2] end
local CatalogBoard = require("bookorbit_catalog_board")
for _, animal in ipairs(companions) do
    if animal ~= "unknown" then
        local entry = Edit.entryFor({ type = "buddy", props = { animal = animal } })
        for _ = 1, 2 do
            local preview = CatalogBoard.boardPreview({}, { d = d }, entry, 200, 160)
            assert(preview.animal == animal, "the gallery shows " .. animal .. " instead of a cached neighbor")
        end
        assert(rendered[animal] == 1, "each companion preview is independently cached")
    end
end

-- A colour screen gives each pet tile a dithered partial refresh of its own,
-- after the tile has been painted; a black-and-white screen does not.
local refreshes = {}
package.loaded["ui/uimanager"].setDirty = function(_, target, refresh)
    assert(target == nil and type(refresh) == "function", "a refresh only, nothing repainted")
    table.insert(refreshes, refresh)
end
local pet_tile, clock_tile = { dimen = {} }, { dimen = { x = 0, y = 0, w = 5, h = 5 } }
local board = { _board_tiles = { { item = { type = "clock" }, tile = clock_tile }, { item = { type = "buddy" }, tile = pet_tile } } }
CatalogBoard.boardRefreshPets(board)
assert(#refreshes == 0, "black and white needs no extra refresh")
colour_screen = true
CatalogBoard.boardRefreshPets(board)
assert(#refreshes == 1, "one refresh per pet tile")
assert(refreshes[1]() == nil, "nothing to refresh before the tile is painted")
pet_tile.dimen = { x = 10, y = 20, w = 30, h = 40 }
local mode, region, dither = refreshes[1]()
assert(mode == "partial" and region == pet_tile.dimen and dither == true, "dithered partial over the pet tile")
colour_screen = false
print("bookorbit_board_buddies_test.lua: ok")
