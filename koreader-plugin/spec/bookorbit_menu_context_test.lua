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

package.loaded["device"] = { model = "test-device" }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/widget/multiinputdialog"] = {}
package.loaded["ui/network/manager"] = {}
package.loaded["ui/widget/notification"] = {}
package.loaded["ui/uimanager"] = {}
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_sweep"] = {
    syncStatus = function()
        return { lastSweepAt = 0, matched = 0, unmatched = 0 }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local MainMenu = require("bookorbit_main_menu")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function itemText(item)
    if item.text then return item.text end
    if item.text_func then return item:text_func() end
end

local function findItem(items, text)
    for _, item in ipairs(items) do
        if itemText(item) == text then return item end
    end
end

local function hasItem(items, text)
    return findItem(items, text) ~= nil
end

local function assertItemText(items, index, text, label)
    assertEqual(itemText(items[index]), text, label)
end

local function assertSeparator(items, index, expected, label)
    assertEqual(items[index].separator == true, expected, label)
end

local function menuItems(plugin)
    local menu_items = {}
    plugin:addToMainMenu(menu_items)
    return menu_items.bookorbit.sub_item_table
end

local function newPlugin(logged_in)
    local plugin = {
        SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
        settings = {
            auto_sync = true,
            annotation_sync = true,
            skip_sync_when_offline = false,
            sync_forward = 1,
            sync_backward = 1,
        },
        isLoggedIn = function()
            return logged_in
        end,
        updateCheckMenuText = function()
            return "Installed plugin: current"
        end,
        getSyncPeriod = function()
            return 10
        end,
    }
    MainMenu.install(plugin)
    return plugin
end

local plugin = newPlugin(false)
local items = menuItems(plugin)
assertEqual(#items, 1, "logged-out menu only has setup group")
assertEqual(hasItem(items, "Account & setup"), true, "logged-out menu keeps account setup")
assertEqual(hasItem(items, "Open dashboard"), false, "logged-out menu hides dashboard")
assertEqual(hasItem(items, "Current book"), false, "logged-out menu hides current book")
assertEqual(hasItem(items, "Sync current book now"), false, "logged-out menu hides current book sync")
assertEqual(hasItem(items, "Sync all books now"), false, "logged-out menu hides sync all")
assertEqual(hasItem(items, "Sync settings"), false, "logged-out menu hides sync settings")
assertEqual(hasItem(items, "Settings"), false, "logged-out menu hides settings")

local account = findItem(items, "Account & setup")
assertEqual(hasItem(account.sub_item_table, "Login"), true, "logged-out setup has login")
local dashboard_items = plugin:dashboardMenuItems()
assertEqual(hasItem(dashboard_items, "Account & setup"), true, "dashboard setup menu keeps account setup when logged out")

plugin = newPlugin(true)
items = menuItems(plugin)
assertEqual(#items, 4, "file manager menu has dashboard, global sync, settings and setup rows")
assertItemText(items, 1, "Open dashboard", "file manager order starts with dashboard")
assertItemText(items, 2, "Sync all books now", "file manager order keeps global sync second")
assertItemText(items, 3, "Settings", "file manager order keeps settings third")
assertItemText(items, 4, "Account & setup", "file manager order ends with setup")
assertSeparator(items, 1, true, "file manager dashboard ends dashboard group")
assertSeparator(items, 2, true, "file manager sync all ends global sync group")
assertSeparator(items, 3, true, "file manager settings ends settings group")
assertSeparator(items, 4, false, "file manager setup has no trailing separator")
assertEqual(hasItem(items, "Open dashboard"), true, "logged-in menu shows dashboard")
assertEqual(hasItem(items, "Open dashboard on startup (Off)"), false, "logged-in top level hides dashboard startup")
assertEqual(hasItem(items, "Installed plugin: current"), false, "logged-in top level hides update row")
assertEqual(hasItem(items, "Current book"), false, "file manager menu hides current book")
assertEqual(hasItem(items, "Sync current book now"), false, "file manager menu hides current book sync")
assertEqual(hasItem(items, "Auto sync current book"), false, "file manager menu hides current book auto sync")
assertEqual(hasItem(items, "Sync all books now"), true, "logged-in menu shows sync all")
assertEqual(hasItem(items, "Two-way highlight sync"), false, "logged-in top level hides highlight toggle")
assertEqual(hasItem(items, "Skip auto-sync when offline"), false, "logged-in top level hides offline skip toggle")
assertEqual(hasItem(items, "Sync settings"), false, "logged-in menu replaces sync settings with settings")
assertEqual(hasItem(items, "Settings"), true, "logged-in menu shows settings")
assertEqual(hasItem(items, "Account & setup"), true, "logged-in menu keeps account setup")
local file_manager_settings = findItem(items, "Settings")
assertEqual(hasItem(file_manager_settings.sub_item_table, "Dashboard"), true, "file manager settings has dashboard group")
assertEqual(hasItem(file_manager_settings.sub_item_table, "Sync"), true, "file manager settings has sync group")
assertEqual(hasItem(file_manager_settings.sub_item_table, "Plugin"), true, "file manager settings has plugin group")
local file_manager_dashboard_settings = findItem(file_manager_settings.sub_item_table, "Dashboard")
assertEqual(hasItem(file_manager_dashboard_settings.sub_item_table, "Open dashboard on startup (Off)"), true, "file manager dashboard settings has startup option")
local file_manager_sync_settings = findItem(file_manager_settings.sub_item_table, "Sync")
assertEqual(hasItem(file_manager_sync_settings.sub_item_table, "Auto sync current book"), false, "file manager sync settings hides reader auto sync")
assertEqual(hasItem(file_manager_sync_settings.sub_item_table, "Two-way highlight sync"), true, "file manager sync settings has highlight toggle")
assertEqual(hasItem(file_manager_sync_settings.sub_item_table, "Skip auto-sync when offline"), true, "file manager sync settings has offline skip toggle")
assertEqual(hasItem(file_manager_sync_settings.sub_item_table, "Open dashboard on startup (Off)"), false, "file manager sync settings excludes dashboard startup")
local file_manager_plugin_settings = findItem(file_manager_settings.sub_item_table, "Plugin")
assertEqual(hasItem(file_manager_plugin_settings.sub_item_table, "Installed plugin: current"), true, "file manager plugin settings has update row")

dashboard_items = plugin:dashboardMenuItems()
assertEqual(hasItem(dashboard_items, "Open dashboard"), false, "dashboard mirror skips open dashboard")
assertItemText(dashboard_items, 1, "Installed plugin: current", "dashboard mirror promotes update row first")
assertItemText(dashboard_items, 2, "Sync all books now", "dashboard mirror keeps sync all second")
assertItemText(dashboard_items, 3, "Settings", "dashboard mirror keeps settings third")
assertItemText(dashboard_items, 4, "Account & setup", "dashboard mirror keeps setup fourth")
assertSeparator(dashboard_items, 1, true, "dashboard mirror update row ends update group")
assertSeparator(dashboard_items, 2, true, "dashboard mirror sync all ends global sync group")
assertSeparator(dashboard_items, 3, true, "dashboard mirror settings ends settings group")
assertSeparator(dashboard_items, 4, false, "dashboard mirror setup has no trailing separator")
assertEqual(hasItem(dashboard_items, "Sync all books now"), true, "dashboard mirror keeps sync all")
assertEqual(hasItem(dashboard_items, "Installed plugin: current"), true, "dashboard mirror top level shows update row")
assertEqual(hasItem(dashboard_items, "Account & setup"), true, "dashboard mirror keeps account setup")
local dashboard_settings = findItem(dashboard_items, "Settings")
local dashboard_dashboard_settings = findItem(dashboard_settings.sub_item_table, "Dashboard")
assertEqual(hasItem(dashboard_dashboard_settings.sub_item_table, "Open dashboard on startup (Off)"), true, "dashboard settings has startup option")
local dashboard_sync_settings = findItem(dashboard_settings.sub_item_table, "Sync")
assertEqual(hasItem(dashboard_sync_settings.sub_item_table, "Two-way highlight sync"), true, "dashboard sync settings has highlight toggle")
assertEqual(hasItem(dashboard_sync_settings.sub_item_table, "Skip auto-sync when offline"), true, "dashboard sync settings has offline skip toggle")
assertEqual(hasItem(dashboard_sync_settings.sub_item_table, "Open dashboard on startup (Off)"), false, "dashboard sync settings excludes dashboard startup")
assertEqual(hasItem(dashboard_settings.sub_item_table, "Plugin"), false, "dashboard settings omits duplicate plugin group")

plugin.ui = { document = {} }
items = menuItems(plugin)
assertEqual(#items, 6, "reader menu has dashboard, current-book, auto-sync, global sync, settings and setup rows")
assertItemText(items, 1, "Open dashboard", "reader order starts with dashboard")
assertItemText(items, 2, "Sync current book now", "reader order keeps current book sync second")
assertItemText(items, 3, "Auto sync current book", "reader order keeps auto sync third")
assertItemText(items, 4, "Sync all books now", "reader order keeps sync all fourth")
assertItemText(items, 5, "Settings", "reader order keeps settings fifth")
assertItemText(items, 6, "Account & setup", "reader order ends with setup")
assertSeparator(items, 1, true, "reader dashboard ends dashboard group")
assertSeparator(items, 2, false, "reader current book sync stays in sync action group")
assertSeparator(items, 3, true, "reader auto sync ends current-book group")
assertSeparator(items, 4, true, "reader sync all ends sync action group")
assertSeparator(items, 5, true, "reader settings ends settings group")
assertSeparator(items, 6, false, "reader setup has no trailing separator")
assertEqual(hasItem(items, "Current book"), false, "reader menu flattens current book actions")
assertEqual(hasItem(items, "Sync current book now"), true, "reader menu has manual book sync")
assertEqual(hasItem(items, "Auto sync current book"), true, "reader top level has auto sync")
assertEqual(hasItem(items, "Push progress"), false, "reader menu hides progress-only push")
assertEqual(hasItem(items, "Pull progress"), false, "reader menu hides progress-only pull")
assertEqual(hasItem(items, "Retry highlight sync"), false, "reader menu hides highlight retry")
assertEqual(hasItem(items, "Retry open-book match"), false, "reader menu hides match retry")

local settings = findItem(items, "Settings")
assertEqual(hasItem(settings.sub_item_table, "Dashboard"), true, "reader settings has dashboard group")
assertEqual(hasItem(settings.sub_item_table, "Sync"), true, "reader settings has sync group")
assertEqual(hasItem(settings.sub_item_table, "Plugin"), true, "reader settings has plugin group")
local reader_dashboard_settings = findItem(settings.sub_item_table, "Dashboard")
assertEqual(hasItem(reader_dashboard_settings.sub_item_table, "Open dashboard on startup (Off)"), true, "reader dashboard settings has startup option")
local sync_settings = findItem(settings.sub_item_table, "Sync")
assertEqual(hasItem(sync_settings.sub_item_table, "Auto sync current book"), false, "reader sync settings excludes top-level auto sync")
assertEqual(hasItem(sync_settings.sub_item_table, "Two-way highlight sync"), true, "sync settings has highlight toggle")
assertEqual(hasItem(sync_settings.sub_item_table, "Skip auto-sync when offline"), true, "sync settings has offline toggle")
assertEqual(hasItem(sync_settings.sub_item_table, "Open dashboard on startup (Off)"), false, "sync settings excludes dashboard startup")
assertEqual(hasItem(items, "Two-way highlight sync"), false, "top level hides highlight toggle")
assertEqual(hasItem(items, "Skip auto-sync when offline"), false, "top level hides offline toggle")
assertEqual(findItem(sync_settings.sub_item_table, "Skip auto-sync when offline").enabled_func(), true, "offline toggle is enabled when auto sync is on")
local reader_plugin_settings = findItem(settings.sub_item_table, "Plugin")
assertEqual(hasItem(reader_plugin_settings.sub_item_table, "Installed plugin: current"), true, "reader plugin settings has update row")

local reader_dashboard_items = plugin:dashboardMenuItems()
assertEqual(hasItem(reader_dashboard_items, "Sync current book now"), false, "dashboard mirror hides current book sync while reader is open")
assertEqual(hasItem(reader_dashboard_items, "Auto sync current book"), false, "dashboard mirror hides auto sync while reader is open")
assertItemText(reader_dashboard_items, 1, "Installed plugin: current", "reader dashboard mirror promotes update row first")
assertItemText(reader_dashboard_items, 2, "Sync all books now", "reader dashboard mirror keeps sync all second")
assertItemText(reader_dashboard_items, 3, "Settings", "reader dashboard mirror keeps settings third")
assertItemText(reader_dashboard_items, 4, "Account & setup", "reader dashboard mirror keeps setup fourth")

plugin.settings.annotation_sync = false
plugin.settings.auto_sync = false
items = menuItems(plugin)
settings = findItem(items, "Settings")
sync_settings = findItem(settings.sub_item_table, "Sync")
assertEqual(findItem(sync_settings.sub_item_table, "Skip auto-sync when offline").enabled_func(), false, "offline toggle is disabled when auto sync is off")
assertEqual(hasItem(items, "Retry highlight sync"), false, "two-way-off reader menu hides highlight retry")
assertEqual(hasItem(items, "Retry open-book match"), false, "two-way-off reader menu hides match retry")

print("bookorbit_menu_context_test.lua: ok")
