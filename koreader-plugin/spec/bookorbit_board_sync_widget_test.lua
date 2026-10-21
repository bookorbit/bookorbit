package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

package.loaded["gettext"] = function(value) return value end
package.loaded["datetime"] = {}
package.loaded["ffi/util"] = {
    template = function(value, replacement) return (value:gsub("%%1", replacement)) end,
}
package.loaded["bookorbit_board_store"] = {}
package.loaded["bookorbit_board_data"] = { relativeDay = function() return "yesterday" end }
package.loaded["bookorbit_board_metrics"] = {
    INK = {}, px = function(value) return value end,
    lh1 = function(value) return value end, lh = function(value) return value end,
}

local function node(value, children)
    return { text = value, children = children, getSize = function() return { w = 10, h = 10 } end }
end
package.loaded["bookorbit_board_ui"] = {
    text = function(value) return node(value) end,
    icon = function() return node() end,
    vstack = function(_, children) return node(nil, children) end,
    hstack = function(_, children) return node(nil, children) end,
    spread = function(_, left, right) return node(nil, { left, right }) end,
    flex = function() return node() end,
    space = function() return node() end,
    pick = function(variants) return variants[1]() end,
}

local Widgets = require("bookorbit_board_widgets")
local function labels(data)
    local result = {}
    local function visit(widget)
        if widget.text then result[widget.text] = true end
        for _, child in ipairs(widget.children or {}) do visit(child) end
    end
    visit(Widgets.W.sync({ d = data }, 200, 150))
    return result
end

local fresh = labels({ online = true, updated = "just now" })
assert(fresh.Sync and fresh["not yet"] and fresh["Sync now"])
assert(not fresh.Synced and not fresh["just now"], "fetching a dashboard cannot claim a sync")

local synced = labels({ online = true, last_sync_at = 123, updated = "just now" })
assert(synced.Synced and synced.yesterday and synced["Sync now"])
assert(not synced["just now"], "the sync label uses the sync time, not the cache time")

local offline = labels({ online = false, last_sync_at = 123, updated = "yesterday" })
assert(offline.Offline and offline["saved yesterday"] and offline.Connect)
assert(not offline.Synced and not offline["Sync now"])

print("bookorbit_board_sync_widget_test.lua: ok")
