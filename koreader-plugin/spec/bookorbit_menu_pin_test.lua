-- Proves where BookOrbit's icon goes in KOReader's menu bar: just before the
-- main menu, once, and nowhere when it is turned off.

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

print("bookorbit_menu_pin_test.lua: ok")
