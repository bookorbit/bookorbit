-- Proves the Home settings that act on the widget board: Customize Home goes
-- Home before entering edit mode, and a new starting layout, tile style or
-- reset goes through the open catalog so the board redraws, or straight to
-- the settings when the catalog is closed.

package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}

local closed = {}
local next_ticks = {}
local shown = {}
package.loaded["ui/uimanager"] = {
    close = function(_, widget)
        table.insert(closed, widget)
    end,
    nextTick = function(_, callback)
        table.insert(next_ticks, callback)
    end,
    show = function(_, widget)
        table.insert(shown, widget)
    end,
}
package.loaded["ui/widget/confirmbox"] = { new = function(_, opts) return opts end }

package.loaded["device"] = { model = "test-device" }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/widget/multiinputdialog"] = {}
package.loaded["ui/network/manager"] = {}
package.loaded["ui/widget/notification"] = {}
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_highlight_diagnostics"] = {}
package.loaded["bookorbit_sweep"] = {
    syncStatus = function()
        return { lastSweepAt = 0, matched = 0, unmatched = 0 }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local flushes = 0
G_reader_settings = {
    flush = function()
        flushes = flushes + 1
    end,
}

local MainMenu = require("bookorbit_main_menu")
local BoardStore = require("bookorbit_board_store")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function resetEvents()
    closed = {}
    next_ticks = {}
    shown = {}
    flushes = 0
end

local function newPlugin()
    local plugin = {
        SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
        settings = {},
    }
    MainMenu.install(plugin)
    return plugin
end

local function newCatalog(plugin, dashboard_mode)
    local catalog = {
        settings = plugin.settings,
        mode = dashboard_mode,
        current_context = { kind = dashboard_mode and "dashboard" or "books", board_page = 3 },
        refreshes = 0,
        events = {},
    }
    function catalog:dashboardMode() return self.mode end
    function catalog:persistSetting(key, value) self.settings[key] = value end
    function catalog:boardRefreshIfMissing() self.refreshes = self.refreshes + 1 end
    function catalog:goDashboard()
        table.insert(self.events, "dashboard")
        self.mode = true
    end
    function catalog:boardEnterEdit() table.insert(self.events, "edit") end
    function catalog:boardSetTiles(tiles)
        self:persistSetting(BoardStore.SETTING_KEY, BoardStore.withTiles(self.settings, tiles))
    end
    return catalog
end

local function findItem(items, text)
    for _, item in ipairs(items) do
        local label = item.text or (item.text_func and item.text_func())
        if label == text then return item end
    end
end

-- Customize Home from a catalog away from the board goes Home first, then
-- enters edit mode on the next tick.
local plugin = newPlugin()
local catalog = newCatalog(plugin, false)
plugin:customizeHome(catalog)
assertEqual(#catalog.events, 0, "nothing happens before the next tick")
next_ticks[1]()
assertEqual(catalog.events[1], "dashboard", "a catalog away from Home goes there first")
assertEqual(catalog.events[2], "edit", "then the board enters edit mode")

-- A catalog already on the board enters edit mode directly.
resetEvents()
catalog = newCatalog(plugin, true)
plugin:customizeHome(catalog)
next_ticks[1]()
assertEqual(#catalog.events, 1, "a catalog on Home does not reopen it")
assertEqual(catalog.events[1], "edit", "the board enters edit mode")

-- From the file manager the catalog opens first, on the board.
resetEvents()
local opened_with
local fresh = newCatalog(plugin, true)
plugin.openCatalogBrowser = function(_, prefer_cached)
    opened_with = prefer_cached
    plugin.catalog_browser = fresh
end
plugin:customizeHome(nil)
assertEqual(opened_with, false, "an explicit customize opens the catalog without preferring the cache")
next_ticks[1]()
assertEqual(fresh.events[1], "edit", "the newly opened board enters edit mode")

-- A new starting layout replaces the reader's pages, returns to the first
-- page and refreshes the open board.
resetEvents()
plugin = newPlugin()
catalog = newCatalog(plugin, true)
plugin.settings[BoardStore.SETTING_KEY] = BoardStore.withCustomPages({}, 4, { { items = { { type = "clock", cw = 1, rh = 1 } } } })
catalog.board_edit = { pages = {} }
plugin:applyBoardSetting(catalog, function(settings) return BoardStore.withPreset(settings, "stats") end)
local state = BoardStore.read(plugin.settings)
assertEqual(state.preset, "stats", "the chosen layout is stored")
assertEqual(state.started, true, "choosing a layout starts the board")
assertEqual(next(state.custom), nil, "the reader's own pages are replaced")
assertEqual(catalog.board_edit, nil, "an edit in progress is dropped")
assertEqual(catalog.current_context.board_page, 1, "the board returns to its first page")
assertEqual(catalog.refreshes, 1, "the open board refreshes once")

-- With the catalog closed the choice is written to the settings directly.
resetEvents()
plugin = newPlugin()
plugin:applyBoardSetting(nil, function(settings) return BoardStore.withPreset(settings, "library") end)
assertEqual(BoardStore.read(plugin.settings).preset, "library", "the layout is stored without a catalog")
assertEqual(flushes, 1, "the settings are flushed")

-- Tile styles go through the catalog so the board redraws.
resetEvents()
plugin = newPlugin()
catalog = newCatalog(plugin, true)
plugin:applyBoardTiles(catalog, "ink")
assertEqual(BoardStore.read(plugin.settings).tiles, "ink", "the tile style is stored")
plugin:applyBoardTiles(nil, "soft")
assertEqual(BoardStore.read(plugin.settings).tiles, "soft", "the tile style is stored without a catalog")

-- Reset restores the current layout's pages and the outline tiles.
resetEvents()
plugin = newPlugin()
catalog = newCatalog(plugin, true)
plugin.settings[BoardStore.SETTING_KEY] = BoardStore.withPreset(plugin.settings, "stats")
plugin.settings[BoardStore.SETTING_KEY] = BoardStore.withTiles(plugin.settings, "ink")
plugin:applyBoardSetting(catalog, function(settings)
    local reset = BoardStore.withPreset(settings, BoardStore.read(settings).preset)
    reset.tiles = "outline"
    return reset
end)
state = BoardStore.read(plugin.settings)
assertEqual(state.preset, "stats", "the reset keeps the chosen layout")
assertEqual(state.tiles, "outline", "the reset restores the outline tiles")
assertEqual(catalog.refreshes, 1, "the reset refreshes the open board")

print("bookorbit_dashboard_board_menu_test.lua: ok")
