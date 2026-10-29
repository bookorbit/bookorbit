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

local Blitbuffer = { TYPE_BB8 = 1, TYPE_BBRGB16 = 5, TYPE_BBRGB24 = 6, TYPE_BBRGB32 = 7 }
local canvases = {}
function Blitbuffer.new(w, h, bb_type)
    local canvas = { w = w, h = h, bb_type = bb_type, fill = function() end }
    table.insert(canvases, canvas)
    return canvas
end
package.loaded["ffi/blitbuffer"] = Blitbuffer

local scaled_from = {}
package.loaded["ui/renderimage"] = {
    scaleBlitBuffer = function(_, bb, w, h)
        table.insert(scaled_from, bb)
        return { w = w, h = h, free = function() end }
    end,
}
package.loaded["ui/bidi"] = {}
package.loaded["bookorbit_board_icons"] = {}
package.loaded["bookorbit_board_metrics"] = {
    INK = { white = 255 },
    px = function(value) return value end,
}

local screen_type
local Screen = { bb = { getType = function() return screen_type end } }
package.loaded["device"] = { screen = Screen }

local BoardUI = require("bookorbit_board_ui")

local function snapshotOn(bb_type, key)
    screen_type = bb_type
    local painted_on
    BoardUI.snapshot(key, 1404, 1872, 300, 400, function()
        return { paintTo = function(_, canvas) painted_on = canvas end }
    end)
    local canvas = canvases[#canvases]
    assert(painted_on == canvas, key .. ": the preview is painted on the new canvas")
    assert(scaled_from[#scaled_from] == canvas, key .. ": the painted canvas is the one scaled down")
    return canvas.bb_type
end

-- MuPDF cannot scale RGB565: KOReader's converter keeps the 16-bit stride and the scale throws,
-- which crashed the first-run layout picker on every reMarkable (issue 1909).
assert(snapshotOn(Blitbuffer.TYPE_BBRGB16, "rgb565") == Blitbuffer.TYPE_BBRGB32,
    "an RGB565 screen draws its thumbnails in RGB32")
assert(snapshotOn(Blitbuffer.TYPE_BB8, "grey") == Blitbuffer.TYPE_BB8,
    "an 8-bit grey screen keeps its own format")
assert(snapshotOn(Blitbuffer.TYPE_BBRGB32, "rgb32") == Blitbuffer.TYPE_BBRGB32,
    "a 32-bit screen keeps its own format")

local count = #canvases
BoardUI.snapshot("rgb565", 1404, 1872, 300, 400, function() error("a cached thumbnail is not rebuilt") end)
assert(#canvases == count, "a cached thumbnail allocates no canvas")

print("bookorbit_board_snapshot_canvas_test.lua: passed")
