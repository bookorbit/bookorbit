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
package.loaded["device"] = { screen = {} }
package.loaded["ffi/blitbuffer"] = {}
package.loaded["bookorbit_board_metrics"] = {
    INK = { black = 0, g5 = 85, g9 = 153, gc = 204, white = 255 },
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
local sprites = require("bookorbit_board_animal_sprites")
local cat = require("bookorbit_board_sprites")
local poses = { "read", "sleep", "party", "ribbon", "yawn", "wait" }
local inks = { ["#"] = 0, d = 85, m = 153, l = 204, ["."] = 255 }

-- Exercise the actual rectangle renderer, including transparent cells and offsets.
for animal, frames in pairs(sprites) do
    local seen = {}
    for _, pose in ipairs(poses) do
        local rows = frames[pose]
        assert(#rows == 40, animal .. "/" .. pose .. " height")
        local signature = table.concat(rows)
        assert(not seen[signature], animal .. " must have six distinct poses")
        seen[signature] = true
        for _, row in ipairs(rows) do
            assert(#row == 40 and not row:find("[^ #dml%.]"), animal .. "/" .. pose .. " palette and width")
        end
        for _, scale in ipairs({ 1, 2, 3, 5, 8 }) do
            local pixels = {}
            local bb = { paintRect = function(_, x, y, w, h, ink)
                assert(x % 1 == 0 and y % 1 == 0 and w % 1 == 0 and h % 1 == 0, "integer pixel edges")
                assert(x >= 7 and y >= 11 and x + w <= 7 + 40 * scale and y + h <= 11 + 40 * scale, "no overflow")
                for yy = y, y + h - 1 do
                    for xx = x, x + w - 1 do pixels[yy * 1000 + xx] = ink end
                end
            end }
            local sprite = Art.sprite(rows, scale)
            assert(sprite:getSize().w == 40 * scale and sprite:getSize().h == 40 * scale)
            sprite:paintTo(bb, 7, 11)
            for y, row in ipairs(rows) do
                for x = 1, #row do
                    local expected = inks[row:sub(x, x)]
                    for dy = 0, scale - 1 do
                        for dx = 0, scale - 1 do
                            assert(pixels[(11 + (y - 1) * scale + dy) * 1000 + 7 + (x - 1) * scale + dx] == expected,
                                animal .. "/" .. pose .. " paints the authored pixel exactly")
                        end
                    end
                end
            end
        end
    end
end

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
for animal in pairs(sprites) do
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
local selected
Art.sprite = function(rows, scale)
    selected = rows
    assert(scale == math.floor(scale) and scale >= 1)
    assert(#rows[1] * scale <= 136 and #rows * scale <= 136, "small tile fits")
    return {}
end
package.loaded["bookorbit_board_decor"] = nil
Decor = require("bookorbit_board_decor")
local companions = { "dog", "rabbit", "owl", "penguin", "robot", "vampire", "dragon", "ghost", "cat", "unknown" }
for _, animal in ipairs(companions) do
    Decor.buddy({ d = d }, 160, 160, { animal = animal })
    assert(selected == (sprites[animal] or cat).ribbon, "selected companion or safe cat fallback")
end
Decor.buddy({ d = d }, 160, 160)
assert(selected == cat.ribbon, "legacy widget still renders the original cat")

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
print("bookorbit_board_buddies_test.lua: ok")
