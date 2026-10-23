package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local widget = {}
function widget:new(options) return options or {} end
function widget:extend(options) return setmetatable(options or {}, { __index = self }) end
for _, name in ipairs({
    "ui/geometry", "ui/widget/container/centercontainer", "ui/widget/container/framecontainer",
    "ui/widget/container/leftcontainer", "ui/widget/container/rightcontainer",
    "ui/widget/container/widgetcontainer", "ui/widget/horizontalgroup", "ui/widget/horizontalspan",
    "ui/widget/overlapgroup", "ui/widget/textboxwidget", "ui/widget/textwidget",
    "ui/widget/verticalgroup", "ui/widget/verticalspan", "ui/widget/widget",
}) do
    package.loaded[name] = widget
end
package.loaded["ui/bidi"] = {}
package.loaded["ui/renderimage"] = {}
package.loaded["device"] = { screen = {} }
package.loaded["bookorbit_board_icons"] = {}
package.loaded["bookorbit_board_metrics"] = { INK = {}, px = function(n) return n end }

local BoardUI = require("bookorbit_board_ui")
local function child(height)
    return { getSize = function() return { w = 50, h = height } end }
end
local function stack(height, strict)
    return BoardUI.vstack({ w = 100, h = 100, pad = 16, strict_padding = strict }, {
        child(height), BoardUI.flex(10),
    })
end

assert(BoardUI.fits(function() return stack(58, true) end), "content may exactly fill the padded interior")
assert(not BoardUI.fits(function() return stack(59, true) end), "content must not consume reserved bottom padding")
assert(BoardUI.fits(function() return stack(59, false) end), "other widgets retain their existing fit policy")
local selected
BoardUI.pick({
    function() selected = "crowded" return stack(70, true) end,
    function() selected = "compact" return stack(50, true) end,
})
assert(selected == "compact", "a crowded card must select a layout that preserves padding")
local fitted = stack(50, true)
local group = fitted[1][2]
assert(group[#group].width == 16, "the bottom inset is preserved in the actual layout")
print("bookorbit_board_padding_test: passed")
