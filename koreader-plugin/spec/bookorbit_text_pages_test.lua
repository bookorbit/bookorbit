-- Long text turns page by page: highlights are packed whole onto pages, and
-- the back button names the book without its subtitle.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local function identity(value) return value end
for _, name in ipairs({ "device", "ui/widget/textboxwidget", "ui/uimanager", "datetime", "bookorbit_board_ui",
    "bookorbit_detail_data", "bookorbit_dialog_ui", "bookorbit_menu_page", "bookorbit_menu_ui" }) do
    package.loaded[name] = {}
end
package.loaded["gettext"] = identity
package.loaded["ffi/util"] = { template = identity }
package.loaded["bookorbit_board_metrics"] = { INK = {}, px = identity, lh = identity }

local TextPages = require("bookorbit_text_pages")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

local pages = TextPages.pack({ 40, 40, 40, 40 }, 100, 10)
assertEqual(#pages, 2, "two 40px blocks and a gap fit a 100px page; a third does not")
assertEqual(pages[1].first, 1, "the first page starts at the first block")
assertEqual(pages[1].last, 2, "and ends where the next would overflow")
assertEqual(pages[2].first, 3, "the next page picks up there")
assertEqual(pages[2].last, 4, "and takes the rest")

pages = TextPages.pack({ 150, 20 }, 100, 10)
assertEqual(#pages, 2, "a block taller than a page gets a page of its own")
assertEqual(pages[1].last, 1, "and is not followed on it")

pages = TextPages.pack({}, 100, 10)
assertEqual(#pages, 1, "no highlights is still one page")

assertEqual(TextPages.backLabel("The Ocean at the End of the Lane"), "The Ocean at the End of the Lane", "a plain title stays whole")
assertEqual(TextPages.backLabel("Piranesi: A Novel"), "Piranesi", "a subtitle after a colon is dropped")
assertEqual(TextPages.backLabel("Dune (Dune Chronicles, #1)"), "Dune", "so is a series note in brackets")
assertEqual(TextPages.backLabel(""), "Back", "a missing title says Back")

print("bookorbit_text_pages_test.lua: ok")
