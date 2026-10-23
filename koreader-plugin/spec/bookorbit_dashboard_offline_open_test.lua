-- Issue 1741: opening the dashboard must never wait for a connection. Every
-- entry point opens the catalog at once; only the auto-open is offline-tolerant
-- from the start, and asking for a connection is left to the catalog's refresh.

package.loaded["gettext"] = function(text)
    return text
end
package.loaded["ffi/util"] = {
    template = function(text)
        return text
    end,
}
package.loaded["ui/uimanager"] = {
    nextTick = function(_, callback) callback() end,
    tickAfterNext = function(_, callback) callback() end,
}
package.loaded["device"] = { model = "test-device" }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/widget/multiinputdialog"] = {}
package.loaded["ui/widget/notification"] = {}
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_highlight_diagnostics"] = {}
package.loaded["bookorbit_sweep"] = {}

local waits = 0
local function waitForConnection()
    waits = waits + 1
    return true
end
local NetworkMgr = {
    isConnected = function()
        return false
    end,
    runWhenConnected = waitForConnection,
    willRerunWhenConnected = waitForConnection,
    beforeWifiAction = waitForConnection,
}
package.loaded["ui/network/manager"] = NetworkMgr

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local MainMenu = require("bookorbit_main_menu")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

-- The entry points live in main.lua, which cannot be loaded whole outside
-- KOReader, so each one is lifted out and run against stubs.
local main = read("koreader-plugin/bookorbit.koplugin/main.lua")
local prompted_login = 0
local env = {
    BookOrbit = {},
    NetworkMgr = NetworkMgr,
    promptLogin = function()
        prompted_login = prompted_login + 1
    end,
}
for _, name in ipairs({ "isLoggedIn", "browseCatalog", "onBookOrbitOpenDashboard", "maybeAutoOpenCatalog" }) do
    local source = assert(main:match("\n(function BookOrbit:" .. name .. "%(.-\nend)\n"), name .. " is defined in main.lua")
    local chunk = assert(loadstring(source, name))
    setfenv(chunk, env)
    chunk()
end

local opened = {}
local plugin = {
    SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
    settings = { server_url = "http://bookorbit.test/api/v1", username = "reader", userkey = "key" },
}
MainMenu.install(plugin)
for name, fn in pairs(env.BookOrbit) do
    plugin[name] = fn
end
plugin.promptLogin = function()
    prompted_login = prompted_login + 1
end
plugin.openCatalogBrowser = function(_, prefer_cached_dashboard)
    table.insert(opened, prefer_cached_dashboard)
end

local function openDashboardMenuItem()
    local menu_items = {}
    plugin:addToMainMenu(menu_items)
    for _, item in ipairs(menu_items.bookorbit.sub_item_table) do
        if item.id == "open_dashboard" then return item end
    end
    error("the BookOrbit menu has an Open BookOrbit item")
end

-- Tools > BookOrbit > Open BookOrbit while offline.
openDashboardMenuItem().callback()
assertEqual(#opened, 1, "the menu opens the dashboard while offline")
assertEqual(opened[1], false, "the menu open is explicit, so its refresh may ask for a connection")
assertEqual(waits, 0, "the menu does not wait for a connection before opening")

-- The gesture and dispatcher action.
opened = {}
plugin:onBookOrbitOpenDashboard()
assertEqual(#opened, 1, "the dispatcher action opens the dashboard while offline")
assertEqual(opened[1], false, "the dispatcher action is an explicit open")
assertEqual(waits, 0, "the dispatcher action does not wait for a connection")

-- The auto-open stays offline-tolerant: it never asks for a connection.
opened = {}
plugin.ui = { file_chooser = {} }
plugin:maybeAutoOpenCatalog("filemanager")
assertEqual(#opened, 1, "the auto-open opens the dashboard")
assertEqual(opened[1], true, "the auto-open prefers the cached dashboard")
assertEqual(waits, 0, "the auto-open does not wait for a connection")

-- Logged out, nothing opens and the user is asked to sign in.
opened = {}
plugin.settings = {}
plugin:browseCatalog()
assertEqual(#opened, 0, "a logged-out open does not open the catalog")
assertEqual(prompted_login, 1, "a logged-out open asks the user to log in")

print("bookorbit_dashboard_offline_open_test.lua: ok")
