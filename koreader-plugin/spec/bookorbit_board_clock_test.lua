package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
for _, name in ipairs({ "ui/event", "ui/geometry", "ui/gesturerange", "ui/network/manager", "logger",
    "bookorbit_board_edit", "bookorbit_board_layout", "bookorbit_board_store", "bookorbit_board_widgets", "bookorbit_catalog_widgets" }) do
    package.loaded[name] = {}
end
package.loaded["device"] = { screen = {} }
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["ui/widget/container/inputcontainer"] = { extend = function(_, value) return value end }
package.loaded["ui/widget/verticalspan"] = { extend = function(_, value) return value end }
package.loaded["bookorbit_board_metrics"] = { INK = {} }
local builds, paints = 0, 0
package.loaded["bookorbit_board_data"] = { build = function() builds = builds + 1; return { clock = "12:01" } end }
package.loaded["bookorbit_board_ui"] = { collectHits = function(build) return build(), { { action = "header" } } end }
package.loaded["ui/uimanager"] = { setDirty = function() paints = paints + 1 end }
local Board = require("bookorbit_catalog_board")
local old_header = { dimen = { x = 0 }, hits = { "edit-done" } }
local catalog = setmetatable({ board_edit = {}, _board_ctx = {}, _board_header = old_header,
    _board_geometry = { w = 600, cols = 4 }, _board_tiles = {}, current_context = {} }, { __index = Board })
function catalog:boardPageNames() return { "Home" } end
function catalog:boardPage() return 1 end
function catalog:boardHeader(data, width, mode) assert(mode == "normal"); return data.clock end
catalog:boardRefreshClock()
assert(builds == 0 and paints == 0, "timer cannot rebuild an editor or its header")
assert(old_header.hits[1] == "edit-done", "Done click target survives clock tick")
catalog.board_edit = nil
catalog:boardRefreshClock()
assert(builds == 1 and paints == 1 and old_header[1] == "12:01", "normal header continues updating each minute")
local brightness, warmth = 50, 50
local power = {
    frontlightIntensity = function() return brightness end,
    frontlightWarmth = function() return warmth end,
    setIntensity = function(_, value) brightness = value end,
    setWarmth = function(_, value) warmth = value end,
}
local device = package.loaded["device"]
device.hasFrontlight = function() return true end
device.hasNaturalLight = function() return true end
device.getPowerDevice = function() return power end
local refreshed = {}
catalog._board_tiles = {
    { item = { type = "light" }, tile = {} },
    { item = { type = "clock" }, tile = {} },
    { item = { type = "light" }, tile = {} },
}
function catalog:boardRefreshTile(entry) refreshed[entry] = true end
catalog:boardAdjustLight("brightness", 5)
assert(brightness == 55 and refreshed[catalog._board_tiles[1]] and refreshed[catalog._board_tiles[3]],
    "all light tiles display the new global brightness")
assert(not refreshed[catalog._board_tiles[2]], "unrelated tiles do not repaint")
catalog:boardAdjustLight("brightness", 100)
assert(brightness == 100, "brightness is clamped at maximum")
catalog:boardAdjustLight("warmth", -100)
assert(warmth == 0, "warmth is clamped at minimum")
print("bookorbit_board_clock_test.lua: ok")
