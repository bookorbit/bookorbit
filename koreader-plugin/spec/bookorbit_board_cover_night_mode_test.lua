package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local widget = {}
function widget:extend(options)
    local class = options or {}
    class.__index = class
    return setmetatable(class, { __index = self })
end
function widget:new(options)
    return setmetatable(options or {}, { __index = self })
end

for _, name in ipairs({
    "ui/geometry", "ui/widget/container/centercontainer", "ui/widget/container/framecontainer",
    "ui/widget/container/leftcontainer", "ui/widget/container/rightcontainer",
    "ui/widget/container/widgetcontainer", "ui/widget/horizontalgroup", "ui/widget/horizontalspan",
    "ui/widget/overlapgroup", "ui/widget/textboxwidget", "ui/widget/textwidget",
    "ui/widget/verticalgroup", "ui/widget/verticalspan", "ui/widget/widget",
}) do
    package.loaded[name] = widget
end

local native_width, native_height = 100, 150
local native = {
    getWidth = function() return native_width end,
    getHeight = function() return native_height end,
}
local scaled = { free = function() end }
package.loaded["ui/renderimage"] = {
    renderImageFile = function() return native end,
    scaleBlitBuffer = function() return scaled end,
}
package.loaded["ui/bidi"] = {}
package.loaded["bookorbit_board_icons"] = {}
package.loaded["bookorbit_board_metrics"] = {
    INK = { gb = 32, ge = 224 },
    px = function(value) return value end,
}

local Screen = { night_mode = false }
package.loaded["device"] = { screen = Screen }

local BoardUI = require("bookorbit_board_ui")
local cover = BoardUI.cover({}, 100, 150, {
    path = "cover.jpg",
    border = 1,
    dim = true,
})

local calls = {}
local bb = setmetatable({}, {
    __index = function(_, name)
        return function(_, ...)
            table.insert(calls, { name, ... })
        end
    end,
})

cover:paintTo(bb, 7, 11)
assert(calls[1][1] == "blitFrom", "the cover image is painted")
assert(calls[2][1] == "lightenRect", "the offline treatment is painted over the image")
assert(calls[3][1] == "paintBorder", "day mode leaves the image colors unchanged")

calls = {}
Screen.night_mode = true
cover:paintTo(bb, 7, 11)
assert(calls[1][1] == "blitFrom", "the cover image is painted in night mode")
assert(calls[2][1] == "lightenRect", "the offline treatment stays before night-mode correction")
assert(calls[3][1] == "invertRect", "night mode counter-inverts the image before the screen is inverted")
assert(calls[3][2] == 7 and calls[3][3] == 11 and calls[3][4] == 100 and calls[3][5] == 150,
    "only the painted image rectangle is counter-inverted")
assert(calls[4][1] == "paintBorder", "the UI border remains subject to night-mode inversion")

native_width, native_height = 100, 100
local plated = BoardUI.cover({}, 100, 150, {
    path = "square-cover.jpg",
    border = 1,
    plate = true,
})
calls = {}
plated:paintTo(bb, 7, 11)
assert(calls[1][1] == "paintRect" and calls[2][1] == "blitFrom", "a nonstandard cover is painted on its plate")
assert(calls[3][1] == "invertRect", "a plated cover is also corrected in night mode")
assert(calls[3][2] == 7 and calls[3][3] == 36 and calls[3][4] == 100 and calls[3][5] == 100,
    "the plate stays inverted with the UI while the image keeps its original colors")
assert(calls[4][1] == "paintBorder", "the plated image border remains subject to night-mode inversion")

print("bookorbit_board_cover_night_mode_test.lua: passed")
