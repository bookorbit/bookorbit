-- Proves KOReader's side of BookOrbit: a trimmed Tools entry, the menu bar
-- tab that acts as a button (and its opt-out), the icon path the tab bar can
-- resolve, and where each of the menu sheet's actions goes.

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

local ticks = {}
local sent_events = {}
package.loaded["device"] = { model = "test-device" }
package.loaded["ui/event"] = { new = function(_, name) return { name = name } end }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/network/manager"] = {
    runWhenConnected = function(_, callback) callback() end,
}
package.loaded["ui/widget/notification"] = {}
package.loaded["ui/uimanager"] = {
    nextTick = function(_, callback) table.insert(ticks, callback) end,
    tickAfterNext = function(_, callback) table.insert(ticks, callback) end,
    sendEvent = function(_, event) table.insert(sent_events, event.name) end,
    show = function() end,
}
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["libs/libkoreader-lfs"] = { currentdir = function() return "/opt/koreader" end }
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_highlight_diagnostics"] = {}
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

local function texts(items)
    local out = {}
    for _, item in ipairs(items) do table.insert(out, itemText(item)) end
    return table.concat(out, "|")
end

local function newPlugin(opts)
    opts = opts or {}
    local calls = {}
    local plugin = {
        settings = { menu_bar_icon = opts.menu_bar_icon },
        path = opts.path or "plugins/bookorbit.koplugin",
        ui = opts.reader and { document = { file = "/books/Book.epub" }, menu = {} } or { menu = {} },
        isLoggedIn = function() return opts.logged_out ~= true end,
        calls = calls,
    }
    MainMenu.install(plugin)
    for _, name in ipairs({ "browseCatalog", "openSignIn", "openBookSheet", "openSettings", "openSyncStatus", "startSweep", "applyUpdate", "customizeHome" }) do
        plugin[name] = function(_, ...) table.insert(calls, { name, ... }) end
    end
    return plugin, calls
end

local function menuItems(plugin)
    local menu_items = {}
    plugin:addToMainMenu(menu_items)
    return menu_items
end

local function runTicks()
    while #ticks > 0 do table.remove(ticks, 1)() end
end

-- The file browser's Tools entry: open BookOrbit, or its settings.
local plugin, calls = newPlugin()
local items = menuItems(plugin)
assertEqual(texts(items.bookorbit.sub_item_table), "Open BookOrbit|Settings", "the Tools entry is two rows in the file browser")
assertEqual(items.bookorbit.sorting_hint, "tools", "the entry still falls back to the Tools menu")

-- In a book it adds This book.
local reader = newPlugin({ reader = true })
assertEqual(texts(menuItems(reader).bookorbit.sub_item_table), "Open BookOrbit|This book|Settings", "a book adds This book")

-- The menu bar tab is a button: never remembered, never a list.
local tab = items.bookorbit_tab
assertEqual(tab ~= nil, true, "the menu bar tab is offered by default")
assertEqual(tab.remember, false, "the tab is never remembered, so opening the menu never fires it")
assertEqual(#tab, 0, "the tab holds no rows")
assertEqual(type(tab.callback), "function", "the tab acts on a tap")

-- Its icon is the shipped SVG, reached from KOReader's icon folders by a
-- climb to the root, with the extension the tab bar adds stripped.
assertEqual(tab.icon:sub(1, 9), "../../../", "the icon name climbs out of the icon folders")
assertEqual(tab.icon:find("opt/koreader/plugins/bookorbit.koplugin/assets/bookorbit.tab", 1, true) ~= nil, true, "a relative plugin path is made absolute")
assertEqual(tab.icon:sub(-4) ~= ".svg", true, "the extension is left to the tab bar")
local user_plugin = newPlugin({ path = "/mnt/onboard/.adds/koreader/plugins/bookorbit.koplugin" })
assertEqual(user_plugin:menuBarIconName():find("../mnt/onboard/.adds/koreader/plugins/bookorbit.koplugin/assets/bookorbit.tab", 1, true) ~= nil, true,
    "an absolute plugin path is used as it is")

-- Turned off, the tab is not registered at all (an unordered item would show
-- up as a NEW: row in the first menu).
local hidden = newPlugin({ menu_bar_icon = false })
assertEqual(menuItems(hidden).bookorbit_tab, nil, "no tab when the icon is turned off")

-- Tapping the tab: BookOrbit in the file browser, This book in a book, and
-- sign-in when signed out, each after the menu's own close.
plugin.ui.menu.onCloseFileManagerMenu = function() table.insert(calls, { "close_fm_menu" }) end
tab.callback()
assertEqual(calls[1][1], "close_fm_menu", "the KOReader menu closes first")
assertEqual(#calls, 1, "nothing opens before the close has painted")
runTicks()
assertEqual(calls[2][1], "browseCatalog", "the file browser's tab opens BookOrbit")

local book, book_calls = newPlugin({ reader = true })
book.ui.menu.onCloseReaderMenu = function() table.insert(book_calls, { "close_reader_menu" }) end
menuItems(book).bookorbit_tab.callback()
runTicks()
assertEqual(book_calls[1][1], "close_reader_menu", "the reader menu closes first")
assertEqual(book_calls[2][1], "openBookSheet", "in a book the tab opens This book")

local out, out_calls = newPlugin({ logged_out = true })
menuItems(out).bookorbit_tab.callback()
runTicks()
assertEqual(out_calls[1][1], "openSignIn", "signed out, the tab opens sign-in")

-- Open BookOrbit from Tools signs in first when needed.
out_calls[1] = nil
out:openBookOrbit()
assertEqual(out_calls[#out_calls][1], "openSignIn", "Open BookOrbit asks for a sign-in when signed out")

-- The sheet's actions close it, then act.
local sheet_plugin, sheet_calls = newPlugin()
local events = {}
local catalog = {
    goDashboard = function() table.insert(events, "home") end,
    onCloseAllMenus = function() table.insert(events, "exit") end,
    onSearchButtonTap = function() table.insert(events, "search") end,
    boardOpenLink = function(_, link) table.insert(events, "link:" .. link) end,
    showBookActions = function() table.insert(events, "list-options") end,
}
local closes, refreshes = 0, 0
local page = {
    close = function() closes = closes + 1 end,
    refresh = function() refreshes = refreshes + 1 end,
    sheet_data = {},
}
package.loaded["bookorbit_menu_sheet"] = { data = function() return { reloaded = true } end }
local function run(action)
    sheet_plugin:onMenuSheetAction(page, catalog, action)
    runTicks()
end
run({ kind = "home" })
run({ kind = "exit" })
run({ kind = "files" })
run({ kind = "search" })
run({ kind = "link", link = "authors" })
run({ kind = "list-options" })
assertEqual(table.concat(events, ","), "home,exit,exit,search,link:authors,list-options", "catalog actions reach the catalog")
assertEqual(table.concat(sent_events, ","), "Home", "Files asks KOReader to open its file browser")
assertEqual(sheet_plugin.skip_return_home_once, true, "Files bypasses the BookOrbit home preference once")
assertEqual(closes, 6, "every action closes the sheet first")

-- Sync now keeps the sheet open: its tile shows the run, then the outcome.
run({ kind = "sync" })
assertEqual(closes, 6, "Sync now leaves the sheet open")
assertEqual(sheet_calls[1][1], "startSweep", "Sync now starts a library sync")
local sweep = sheet_calls[1][2]
assertEqual(sweep.quiet, true, "the sync reports to the sheet, not a dialog")
assertEqual(page.sheet_data.sync.running, true, "the tile says the sync is running")
sweep.on_progress("Matching books")
assertEqual(page.sheet_data.sync.text, "Matching books", "the short progress line is shown")
sweep.on_done(nil)
assertEqual(page.sheet_data.reloaded, true, "the sheet's numbers are reloaded when the sync ends")
assertEqual(page.sheet_data.sync.done, true, "the tile says the sync finished")
assertEqual(refreshes, 3, "the sheet redraws at start, on progress and at the end")
plugin.errorLabel = function() return "fallback" end
sheet_plugin.errorLabel = plugin.errorLabel
sweep.on_done("not_started")
assertEqual(page.sheet_data.sync.err, "Another sync is running", "a sync that did not start says why")

table.remove(sheet_calls, 1)
run({ kind = "settings" })
run({ kind = "status" })
run({ kind = "about" })
run({ kind = "customize" })
local names = {}
for _, call in ipairs(sheet_calls) do table.insert(names, call[1]) end
assertEqual(table.concat(names, ","), "openSettings,openSyncStatus,openSettings,customizeHome", "plugin actions reach the plugin")
assertEqual(sheet_calls[3][3], "about", "Help & about opens settings on About")

print("bookorbit_menu_context_test.lua: ok")
