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
package.loaded["ui/uimanager"] = {
    close = function(_, widget)
        table.insert(closed, widget)
    end,
    nextTick = function(_, callback)
        table.insert(next_ticks, callback)
    end,
}

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
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function resetEvents()
    closed = {}
    next_ticks = {}
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

local plugin = newPlugin()
local menu_container = { id = "dashboard-menu-container" }
local touchmenu = { id = "inner-touch-menu", updates = 0, menu_closes = 0 }
function touchmenu:updateItems()
    self.updates = self.updates + 1
end
-- A TouchMenu closes itself through closeMenu(), which runs the close_callback
-- that owns its container. Closing the widget directly would leave that behind.
function touchmenu:closeMenu()
    self.menu_closes = self.menu_closes + 1
end

local loaded
local catalog = {
    loadSection = function(_, section, opts)
        loaded = { section = section, index = opts.dashboard_source_index }
    end,
}

plugin.dashboard_menu_container = menu_container
plugin:chooseDashboardCatalogSource(3, "authors", catalog, touchmenu)
assertEqual(#closed, 1, "catalog selection closes one menu container")
assertEqual(closed[1], menu_container, "catalog selection closes the outer dashboard menu container")
assertEqual(touchmenu.menu_closes, 0, "the outer container's close covers the menu inside it")
assertEqual(plugin.dashboard_menu_container, nil, "the closed dashboard menu container is cleared")
assertEqual(#next_ticks, 1, "catalog selection is deferred until the menu closes")
assertEqual(loaded, nil, "the catalog is not opened before the deferred callback")
next_ticks[1]()
assertEqual(loaded.section, "authors", "the selector opens the requested catalog section")
assertEqual(loaded.index, 3, "the selector preserves the target dashboard slot")

resetEvents()
loaded = nil
plugin.dashboard_menu_container = nil
plugin:chooseDashboardCatalogSource(4, "series", catalog, touchmenu)
assertEqual(#closed, 0, "the invoking touch menu is not closed as a bare widget")
assertEqual(touchmenu.menu_closes, 1, "without an outer container the invoking touch menu closes itself")
next_ticks[1]()
assertEqual(loaded.section, "series", "fallback selection opens the requested section")
assertEqual(loaded.index, 4, "fallback selection preserves the target slot")

resetEvents()
loaded = nil
local opened_with
plugin.openCatalogBrowser = function(_, prefer_cached_dashboard)
    opened_with = prefer_cached_dashboard
    plugin.catalog_browser = catalog
end
plugin:chooseDashboardCatalogSource(2, "libraries", nil, nil)
assertEqual(opened_with, false, "selection opens a fresh catalog when no catalog instance exists")
assertEqual(#next_ticks, 1, "a newly opened catalog is entered on the next tick")
next_ticks[1]()
assertEqual(loaded.section, "libraries", "the new catalog opens at the requested selector")
assertEqual(loaded.index, 2, "the new catalog receives the requested slot")

resetEvents()
local selected
catalog.setDashboardSection = function(_, config, index)
    selected = { config = config, index = index }
end
plugin:applyDashboardSection(1, { type = "stats" }, catalog, touchmenu)
assertEqual(selected.config.type, "stats", "direct choices are applied through the active catalog")
assertEqual(selected.index, 1, "direct choices preserve the target slot")
assertEqual(touchmenu.updates, 1, "the invoking menu refreshes after a direct choice")

-- Restoring the defaults goes through the catalog in one write, so the slots
-- and the dashboard's cache signature stay in step.
resetEvents()
local reset_to
catalog.setDashboardSections = function(_, sections)
    reset_to = sections
end
plugin:resetDashboardSections(catalog, touchmenu)
assertEqual(reset_to[1].type, "stats", "the reset restores the default slot 1")
assertEqual(reset_to[3].type, "random", "the reset restores the default slot 3")
assertEqual(reset_to.schemaVersion, DashboardSections.SCHEMA_VERSION, "the reset writes the current schema marker")
assertEqual(touchmenu.updates, 2, "the invoking menu refreshes after a reset")

-- Without an open catalog the reset writes the setting itself.
resetEvents()
plugin.settings[DashboardSections.SETTING_KEY] = { { type = "recently-added" } }
plugin:resetDashboardSections(nil, nil)
assertEqual(plugin.settings[DashboardSections.SETTING_KEY][3].type, "random", "a reset without a catalog still restores the defaults")
assertEqual(flushes, 1, "a reset without a catalog persists the settings")

local items = plugin:dashboardSectionItems(4, catalog)
local function findItem(text)
    for _, item in ipairs(items) do
        if item.text == text then return item end
    end
end
assertEqual(findItem("All Books"), nil, "All Books remains a destination inside Browse")
assertEqual(findItem("On device"), nil, "On device remains a destination inside Browse")

local selectors = {
    Authors = "authors",
    Series = "series",
    Collections = "collections",
    Libraries = "libraries",
    SmartScopes = "smart-scopes",
}
for label, section in pairs(selectors) do
    local item = findItem(label)
    assertEqual(item ~= nil, true, label .. " is offered as a slot source")
    resetEvents()
    loaded = nil
    item.callback(touchmenu)
    assertEqual(item.mandatory, ">", label .. " exposes a drill-down indicator")
    assertEqual(item.keep_menu_open, true, label .. " is marked as a selector")
    next_ticks[1]()
    assertEqual(loaded.section, section, label .. " callback opens the matching catalog section")
    assertEqual(loaded.index, 4, label .. " callback preserves the configured slot")
end

print("bookorbit_dashboard_catalog_selection_test.lua: ok")
