-- Proves where BookOrbit's icon goes in KOReader's menu bar, then proves
-- later plugin entries survive and old complete-list files are migrated.

package.loaded["datastorage"] = { getSettingsDir = function() return "/tmp" end }
package.loaded["dump"] = function() return "" end
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["logger"] = { warn = function() end }
package.loaded["util"] = {}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local MenuPin = require("bookorbit_menu_pin")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local fm = { "filemanager_settings", "setting", "tools", "search", "plus_menu", "main" }
MenuPin.normalizeButtons(fm, true)
assertEqual(table.concat(fm, ","), "filemanager_settings,setting,tools,search,plus_menu,bookorbit_tab,main",
    "the file browser gets the icon before the main menu")

local reader = { "navi", "typeset", "setting", "tools", "search", "filemanager", "main" }
MenuPin.normalizeButtons(reader, true)
assertEqual(reader[7], "bookorbit_tab", "the reader gets the icon before the main menu")
MenuPin.normalizeButtons(reader, true)
local count = 0
for _, id in ipairs(reader) do if id == "bookorbit_tab" then count = count + 1 end end
assertEqual(count, 1, "running again keeps one icon")

MenuPin.normalizeButtons(reader, false)
assertEqual(table.concat(reader, ","), "navi,typeset,setting,tools,search,filemanager,main", "turned off, the icon goes")

-- A menu bar without a main button gets the icon at the end.
local custom = { "tools", "search" }
MenuPin.normalizeButtons(custom, true)
assertEqual(custom[3], "bookorbit_tab", "no main button: the icon goes last")

package.loaded["bookorbit_menu_pin"] = nil
package.path = "koreader-plugin/spec/?.lua;koreader-plugin/spec/helpers/?.lua;" .. package.path
local TempFilesystem = require("temp_filesystem")
local fs = TempFilesystem.new()

local function readFile(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local content = file:read("*a")
    file:close()
    return content
end

local filemanager_order = {
    ["KOMenu:menu_buttons"] = {
        "filemanager_settings", "setting", "tools", "search", "plus_menu", "main",
    },
    tools = { "read_timer", "calibre", "exporter" },
}
local reader_order = {
    ["KOMenu:menu_buttons"] = { "navi", "typeset", "setting", "tools", "search", "filemanager", "main" },
    tools = { "read_timer", "calibre", "exporter" },
}

package.loaded["datastorage"] = { getSettingsDir = function() return fs.path end }
package.loaded["dump"] = function(value) return fs:serialize(value):gsub("\n$", ""):gsub("^return ", "") end
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attribute) return fs:attributes(path, attribute) end,
}
package.loaded["logger"] = { warn = function(...) error(table.concat({ ... }, " ")) end }
package.loaded["util"] = {
    readFromFile = readFile,
    writeToFile = function(content, path, _force_flush, lua_dofile_ready)
        if lua_dofile_ready then
            content = "-- " .. path .. "\nreturn " .. content .. "\n"
        end
        return fs:write(content, path)
    end,
}
package.loaded["ui/elements/filemanager_menu_order"] = filemanager_order
package.loaded["ui/elements/reader_menu_order"] = reader_order

local IntegrationMenuPin = require("bookorbit_menu_pin")

local generated_path = fs.path .. "/filemanager_menu_order.lua"
assert(fs:write(
    "-- bookorbit-menu-pin v3 (generated; delete this file to reset menu order)\n"
        .. "return { tools = { 'calibre', 'bookorbit' }, "
        .. "['KOMenu:menu_buttons'] = { 'tools', 'bookorbit_tab', 'main' } }\n",
    generated_path))

local hand_path = fs.path .. "/reader_menu_order.lua"
assert(fs:write(fs:serialize({
    ["KOMenu:menu_buttons"] = { "navi", "custom_tab", "tools", "main" },
    custom_tab = { "custom_action" },
    tools = { "calibre", "custom_tool" },
}), hand_path))

IntegrationMenuPin.ensure(true)
assertEqual(fs:attributes(generated_path), nil, "generated overrides are removed")
assertEqual(table.concat(filemanager_order["KOMenu:menu_buttons"], ","),
    "filemanager_settings,setting,tools,search,plus_menu,bookorbit_tab,main",
    "BookOrbit extends the shared file-manager button order")
assertEqual(table.concat(filemanager_order.tools, ","), "read_timer,calibre,bookorbit,exporter",
    "BookOrbit extends the shared tools order")

-- Bookshelf and another plugin load after BookOrbit.
table.insert(filemanager_order["KOMenu:menu_buttons"], 2, "bookshelf_tab")
filemanager_order.bookshelf_tab = { "bookshelf_toggle" }
table.insert(filemanager_order.tools, 2, "later_plugin_tool")
assertEqual(table.concat(filemanager_order["KOMenu:menu_buttons"], ","),
    "filemanager_settings,bookshelf_tab,setting,tools,search,plus_menu,bookorbit_tab,main",
    "later plugin tabs remain in the shared order")
assertEqual(table.concat(filemanager_order.tools, ","),
    "read_timer,later_plugin_tool,calibre,bookorbit,exporter",
    "later plugin tools remain in the shared order")

local hand_order = assert(loadfile(hand_path))()
assertEqual(table.concat(hand_order["KOMenu:menu_buttons"], ","),
    "navi,custom_tab,tools,bookorbit_tab,main", "hand-maintained tabs are preserved")
assertEqual(table.concat(hand_order.tools, ","), "calibre,bookorbit,custom_tool",
    "hand-maintained tools are preserved")

IntegrationMenuPin.refresh(false)
assertEqual(table.concat(filemanager_order["KOMenu:menu_buttons"], ","),
    "filemanager_settings,bookshelf_tab,setting,tools,search,plus_menu,main",
    "disabling the icon preserves later plugin tabs")
assertEqual(table.concat(filemanager_order.tools, ","),
    "read_timer,later_plugin_tool,calibre,bookorbit,exporter",
    "disabling the icon preserves later plugin tools")

fs:cleanup()

print("bookorbit_menu_pin_test.lua: ok")
