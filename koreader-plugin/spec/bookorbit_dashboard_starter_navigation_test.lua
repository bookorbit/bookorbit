-- Proves that the first-run dashboard chooser exposes each preset and the
-- Start button to KOReader's D-Pad focus layout on non-touch devices.

local function widget(width, height, children)
    return {
        width = width or 0,
        height = height or 0,
        children = children,
        getSize = function(self) return { w = self.width, h = self.height } end,
    }
end

local function class()
    local base = {}
    function base:getSize()
        return { w = self.dimen and self.dimen.w or 0, h = self.dimen and self.dimen.h or 0 }
    end
    function base:extend(spec)
        spec = spec or {}
        spec.__index = spec
        setmetatable(spec, { __index = self })
        function spec:new(opts)
            opts = opts or {}
            setmetatable(opts, spec)
            if opts.init then opts:init() end
            return opts
        end
        return spec
    end
    return base
end

package.loaded["device"] = {
    screen = {},
    hasDPad = function() return true end,
    isTouchDevice = function() return false end,
}
package.loaded["ui/event"] = { new = function(_, name) return { name = name } end }
package.loaded["ui/geometry"] = { new = function(_, opts) return opts end }
package.loaded["ui/gesturerange"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/container/inputcontainer"] = class()
package.loaded["ui/widget/verticalspan"] = class()
package.loaded["ui/network/manager"] = {}
package.loaded["ui/uimanager"] = {}
package.loaded["logger"] = {}
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}

local function stack(horizontal, opts, children)
    local width, height = 0, 0
    for _, child in ipairs(children or {}) do
        if child then
            local size = child:getSize()
            if horizontal then
                width = width + size.w
                height = math.max(height, size.h)
            else
                width = math.max(width, size.w)
                height = height + size.h
            end
        end
    end
    return widget(opts.w or width, opts.h or height, children)
end

local BoardUI = {
    text = function(value, opts) return widget((opts and opts.w) or #tostring(value) * 7, 18) end,
    runs = function() return widget(100, 18) end,
    vstack = function(opts, children) return stack(false, opts, children) end,
    hstack = function(opts, children) return stack(true, opts, children) end,
    flex = function(minimum) return widget(0, minimum or 0) end,
    space = function(width, height) return widget(width or 0, height or 0) end,
    icon = function(_, size) return widget(size, size) end,
    overlay = function(width, height, children) return widget(width, height, children) end,
    rect = function(width, height) return widget(width, height) end,
    box = function(opts, child)
        local size = child and child:getSize() or { w = 0, h = 0 }
        return widget(opts.w or size.w, opts.h or size.h, { child })
    end,
    circle = function(size) return widget(size, size) end,
    hit = function(value) return value end,
    dot = function(size) return widget(size, size) end,
    snapshot = function(_, _, _, width, height) return widget(width, height) end,
    collectHits = function(build) return build(), {} end,
    clearSnapshots = function() end,
    statusCluster = function() return widget(40, 20) end,
}
package.loaded["bookorbit_board_ui"] = BoardUI
package.loaded["bookorbit_board_data"] = {}
package.loaded["bookorbit_board_edit"] = {}
package.loaded["bookorbit_board_layout"] = {}
package.loaded["bookorbit_board_store"] = {
    SETTING_KEY = "catalog_board",
    PAGE_COUNT = 4,
    starterPages = function() return { {}, {}, {}, {} } end,
    pageNames = function() return { "Home", "Insights", "Library", "Decor" } end,
    withPreset = function(_, preset) return { preset = preset, started = true } end,
}
package.loaded["bookorbit_board_widgets"] = {}

local focusable_calls = 0
package.loaded["bookorbit_catalog_widgets"] = {
    focusable = function(value)
        focusable_calls = focusable_calls + 1
        value.focusable = true
        return value
    end,
}
package.loaded["bookorbit_board_metrics"] = {
    INK = { white = 1, black = 0, g3 = 3, g4 = 4, ge = 5, gb = 6 },
    px = function(value) return value end,
    lh1 = function(value) return value end,
    lh = function(value) return value end,
    get = function() return { W = 600 } end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogBoard = require("bookorbit_catalog_board")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local catalog = setmetatable({
    board_starter_choice = "reader",
    current_context = { board_page = 3 },
    settings = {},
    updates = 0,
    refreshes = 0,
}, { __index = CatalogBoard })
function catalog:boardHasLight() return false end
function catalog:boardLandscape() return false end
function catalog:updateItems() self.updates = self.updates + 1 end
function catalog:persistSetting(key, value) self.settings[key] = value end
function catalog:boardRefreshIfMissing() self.refreshes = self.refreshes + 1 end

local screen, rows = catalog:boardBuildStarter({}, { mx = 20, cols = 4 }, 600, 800)
assertEqual(screen:getSize().w, 600, "the chooser keeps the full dashboard width")
assertEqual(#rows, 2, "the chooser exposes preset and Start rows")
assertEqual(#rows[1], 3, "all three presets share a focus row")
assertEqual(#rows[2], 1, "the Start button has its own focus row")
assertEqual(focusable_calls, 4, "every reachable control draws a D-Pad focus cursor")

rows[1][2]:onTapSelect()
assertEqual(catalog.board_starter_choice, "stats", "pressing the focused Stats preset selects it")
assertEqual(catalog.updates, 1, "selecting a preset redraws the chooser")

local _, updated_rows = catalog:boardBuildStarter({}, { mx = 20, cols = 4 }, 600, 800)
assertEqual(updated_rows[2][1].item.action.preset, "stats", "the redrawn Start button carries the selected preset")
updated_rows[2][1]:onTapSelect()
assertEqual(catalog.settings.catalog_board.preset, "stats", "pressing focused Start stores the selected preset")
assertEqual(catalog.settings.catalog_board.started, true, "pressing focused Start completes setup")
assertEqual(catalog.current_context.board_page, 1, "the started dashboard opens on its first page")
assertEqual(catalog.refreshes, 1, "the started dashboard replaces the chooser")

print("bookorbit_dashboard_starter_navigation_test.lua: ok")
