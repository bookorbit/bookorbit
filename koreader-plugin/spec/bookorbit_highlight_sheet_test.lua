-- The Highlight of the day drawer keeps every line reachable in bounded pages.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function identity(value) return value end
for _, name in ipairs({ "device", "ui/widget/textboxwidget", "ui/uimanager", "bookorbit_board_ui",
    "bookorbit_dialog_ui", "bookorbit_text_pages" }) do
    package.loaded[name] = {}
end
package.loaded["gettext"] = identity
package.loaded["bookorbit_board_metrics"] = { INK = {}, px = identity, lh = identity }

local HighlightSheet = require("bookorbit_highlight_sheet")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

local window = HighlightSheet.pageWindow(23, 100, 10, 1)
assertEqual(window.per_page, 10, "the drawer fits ten lines")
assertEqual(window.count, 3, "all lines are split across three pages")
assertEqual(window.first_line, 1, "the first page starts at the first line")
assertEqual(window.height, 100, "multipage drawers keep a stable text height")

window = HighlightSheet.pageWindow(23, 100, 10, 3)
assertEqual(window.first_line, 21, "the last page starts after the first twenty lines")
assertEqual(window.height, 100, "the last page keeps the drawer from jumping")

window = HighlightSheet.pageWindow(3, 100, 10, 8)
assertEqual(window.count, 1, "a short highlight needs one page")
assertEqual(window.index, 1, "the requested page is clamped")
assertEqual(window.height, 30, "a short highlight keeps the drawer compact")

print("bookorbit_highlight_sheet_test.lua: ok")
