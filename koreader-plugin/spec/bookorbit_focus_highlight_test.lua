-- Proves the focus chrome the catalog's tappable widgets draw for a D-Pad
-- cursor: that it exists at all on a keyboard-only device, that it is an inner
-- border so adding it cannot resize a widget and reflow the page around it,
-- that a touchscreen pays nothing for it, and that no tappable widget is left
-- without it.

local function stubWidget()
    local class = {}
    class.new = function(_, opts) return opts or {} end
    class.extend = function(_, spec)
        spec = spec or {}
        spec.new = class.new
        spec.extend = class.extend
        return spec
    end
    return class
end

local function anyNumber()
    return setmetatable({}, { __index = function() return 1 end })
end

package.loaded["ui/bidi"] = { auto = function(text) return text end }
package.loaded["ffi/blitbuffer"] = setmetatable({}, { __index = function() return 0 end })
package.loaded["ui/font"] = { getFace = function() return { size = 10 } end }
package.loaded["ui/geometry"] = stubWidget()
package.loaded["ui/gesturerange"] = stubWidget()
package.loaded["ui/size"] = setmetatable({}, { __index = function() return anyNumber() end })
package.loaded["gettext"] = function(text) return text end
package.loaded["util"] = { fixUtf8 = function(value) return value end }
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }

for _, name in ipairs({
    "ui/widget/container/centercontainer",
    "ui/widget/container/framecontainer",
    "ui/widget/container/inputcontainer",
    "ui/widget/container/leftcontainer",
    "ui/widget/container/rightcontainer",
    "ui/widget/horizontalgroup",
    "ui/widget/horizontalspan",
    "ui/widget/iconwidget",
    "ui/widget/imagewidget",
    "ui/widget/linewidget",
    "ui/widget/overlapgroup",
    "ui/widget/progresswidget",
    "ui/widget/textboxwidget",
    "ui/widget/textwidget",
    "ui/widget/verticalgroup",
    "ui/widget/verticalspan",
}) do
    package.loaded[name] = stubWidget()
end

local touch = false
package.loaded["device"] = {
    screen = { scaleBySize = function(_, value) return value end },
    hasDPad = function() return true end,
    isTouchDevice = function() return touch end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function loadWidgets()
    package.loaded["bookorbit_catalog_widgets"] = nil
    package.loaded["bookorbit_catalog_util"] = nil
    return require("bookorbit_catalog_widgets")
end

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- A D-Pad with no touchscreen is the case that has to draw a cursor.
local CatalogWidgets = loadWidgets()
assertEqual(CatalogWidgets.focusNavigation(), true, "a keyboard-only device navigates by focus")

local child = { "content" }
local frame = CatalogWidgets.focusable(child)
assertEqual(frame ~= child, true, "the widget's root is wrapped in a focus frame")
assertEqual(frame[1], child, "the frame carries the original root untouched")
assertEqual(frame.focusable, true, "the frame answers Focus events")
assertEqual(frame.focus_inner_border, true, "the cursor is drawn inside the frame's own bounds")
assertEqual(frame.focus_border_size > 0, true, "with a visible border width")
-- The inner border is the whole point: the dashboard and detail pages size
-- themselves from fixed dimensions, so a cursor that grew a widget would push
-- the rest of the page around every time it moved.
assertEqual(frame.bordersize, 0, "the resting frame adds no border of its own")
assertEqual(frame.padding, 0, "nor any padding")
assertEqual(frame.margin, 0, "nor any margin")

-- A touchscreen never shows the cursor, so it should not pay for the frame.
touch = true
CatalogWidgets = loadWidgets()
assertEqual(CatalogWidgets.focusNavigation(), false, "a touch device does not navigate by focus")
assertEqual(CatalogWidgets.focusable(child), child, "and gets its root back unwrapped")
touch = false

-- Every tappable widget in these two files sets its root as `self[1]`, and each
-- one has to route through the helper: a new widget added without it would be
-- invisible to a D-Pad user, which is exactly the bug this fixes.
local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

local plugin_dir = "koreader-plugin/bookorbit.koplugin/"
for _, name in ipairs({ "bookorbit_catalog_widgets.lua", "bookorbit_catalog_detail.lua" }) do
    local source = read(plugin_dir .. name)
    local roots, wrapped = 0, 0
    for assignment in source:gmatch("self%[1%] = ([%w_.]+)") do
        roots = roots + 1
        if assignment == "CatalogWidgets.focusable" then
            wrapped = wrapped + 1
        end
    end
    assertEqual(roots > 0, true, name .. " defines widget roots")
    assertEqual(wrapped, roots, "every widget root in " .. name .. " draws a focus cursor")
end

print("bookorbit_focus_highlight_test.lua: ok")
