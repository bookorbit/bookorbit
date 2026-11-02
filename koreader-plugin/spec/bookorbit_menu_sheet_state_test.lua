package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["datetime"] = { secondsToHour = function() return "12:00" end }
package.loaded["bookorbit_board_metrics"] = { INK = {}, px = function(value) return value end }
package.loaded["bookorbit_board_ui"] = {}
package.loaded["bookorbit_menu_page"] = {}
package.loaded["bookorbit_menu_ui"] = {
    serverHost = function() return "localhost" end,
    ago = function(value) return value and "recently" or nil end,
}
G_reader_settings = { isTrue = function() return false end }
local Sheet = require("bookorbit_menu_sheet")
local plugin = { settings = {}, isLoggedIn = function() return true end }
local catalog = { current_context = {} }
local function check(context, expected)
    catalog.current_context = context
    assert(Sheet.data(plugin, catalog).place == expected, "incorrect current destination")
end
check({ kind = "books", on_device_filter = true }, "device")
check({ kind = "books", on_device_filter = false }, "library")
check({ kind = "books", params = { authorId = "author" } }, nil)
check({ kind = "books", params = { author = "author" } }, nil)
check({ kind = "books", params = { smartScopeId = 1 } }, nil)
check({ kind = "section", section = "shelves" }, "shelves")
check({ kind = "section", section = "authors" }, "authors")
check({ kind = "section", section = "series" }, "series")
plugin.settings.last_sync = { event = "connection_test", at = 1 }
assert(Sheet.data(plugin, catalog).synced == nil, "connection test is not a sync")
plugin.settings.last_sync = { event = "progress_push", at = 1 }
assert(Sheet.data(plugin, catalog).synced == "recently", "actual sync retains its timestamp")
plugin.settings.last_error = { event = "connection_test", at = 2 }
assert(not Sheet.data(plugin, catalog).sync_error, "connection failure is not a sync failure")
plugin.settings.last_error = { event = "annotation_sync", at = 2 }
assert(Sheet.data(plugin, catalog).sync_error, "actual sync failure is shown")
plugin.settings.last_sync = { event = "connection_test", at = 3 }
assert(Sheet.data(plugin, catalog).sync_error, "legacy connection timestamp cannot suppress sync failure")
plugin.ui = { document = {} }
plugin.openBookTitle = function() return "Open book" end
assert(Sheet.data(plugin, catalog).book == "Open book", "an open reader book exposes both exit destinations")
print("bookorbit_menu_sheet_state_test.lua: ok")
