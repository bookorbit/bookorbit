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
function widget:getSize()
    return self.dimen or { w = 0, h = 0 }
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

local function grey(value) return { grey = value } end
local function rgb(r, g, b) return { r = r, g = g, b = b } end

package.loaded["ffi/blitbuffer"] = {
    isColor8 = function(color) return color.grey ~= nil end,
}
package.loaded["ui/bidi"] = {}
package.loaded["ui/renderimage"] = {}
package.loaded["bookorbit_board_icons"] = {}
package.loaded["bookorbit_board_metrics"] = {
    INK = {
        black = grey(0), white = grey(255), ga = grey(160), gc = grey(192),
    },
    px = function(value) return value end,
}

local android = true
package.loaded["device"] = {
    screen = {},
    isAndroid = function() return android end,
}

local BoardUI = require("bookorbit_board_ui")

local view_calls = {}
local view = {
    inverse = 1,
    setInverse = function(self, value) self.inverse = value end,
    paintRoundedRectRGB32 = function(_, ...) table.insert(view_calls, { "fill", ... }) end,
    paintBorderRGB32 = function(_, ...) table.insert(view_calls, { "border", ... }) end,
}
local viewport_calls = 0
local source = {
    inverse = 1,
    getInverse = function(self) return self.inverse end,
    getWidth = function() return 600 end,
    getHeight = function() return 800 end,
    viewport = function(_, x, y, w, h)
        viewport_calls = viewport_calls + 1
        assert(x == 0 and y == 0 and w == 600 and h == 800, "the view covers the source buffer")
        view.inverse = 1
        return view
    end,
    paintRoundedRectRGB32 = function() error("RGB fill used the inverted Android buffer") end,
    paintBorderRGB32 = function() error("RGB border used the inverted Android buffer") end,
    paintRoundedRect = function() end,
    paintBorder = function() end,
}

local safe = BoardUI.rgbCanvas(source)
assert(safe == view, "Android night mode returns a non-owning buffer view")
assert(view.inverse == 0, "the view disables paint-time inversion")
assert(source.inverse == 1, "the screen buffer keeps its display-time inversion")

source.inverse = 0
assert(BoardUI.rgbCanvas(source) == source, "Android light mode keeps the original buffer")
source.inverse = 1
android = false
assert(BoardUI.rgbCanvas(source) == source, "other platforms keep their normal inversion path")
android = true

local color = rgb(40, 90, 180)
local rect = BoardUI.rect(80, 40, color, 8)
rect:paintTo(source, 10, 20)
assert(view_calls[#view_calls][1] == "fill", "an RGB rectangle paints through the safe view")

local box = BoardUI.box({ w = 80, h = 40, border = 2, border_col = color, radius = 8 })
box[#box]:paintTo(source, 12, 22)
assert(view_calls[#view_calls][1] == "border", "an RGB border paints through the safe view")

viewport_calls = 0
local grid = BoardUI.cellGrid(40, 40, 20, 4, {
    { x = 0, y = 0, col = color },
    { x = 20, y = 0, col = color, border = 2 },
})
grid:paintTo(source, 5, 7)
assert(view_calls[#view_calls - 1][1] == "fill", "an RGB grid cell paints through the safe view")
assert(view_calls[#view_calls][1] == "border", "an RGB grid border paints through the safe view")
assert(viewport_calls == 1, "a grid reuses one safe view for its RGB primitives")

print("bookorbit_board_android_night_test.lua: ok")
