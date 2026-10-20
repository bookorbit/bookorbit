-- Picking where a Home shelf's books come from uses the list pages
-- themselves: in pick mode a tapped author, series or shelf becomes the shelf
-- instead of opening.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["document/documentregistry"] = {}
package.loaded["util"] = { trim = function(text) return text end }
for _, name in ipairs({ "device", "ui/network/manager", "ui/uimanager", "datetime", "logger",
    "bookorbit_board_data", "bookorbit_board_metrics", "bookorbit_capabilities", "bookorbit_list_cache",
    "bookorbit_list_data", "bookorbit_list_pages", "bookorbit_list_view" }) do package.loaded[name] = {} end

local Lists = require("bookorbit_catalog_lists")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

local function catalogIn(context)
    local catalog = setmetatable({ current_context = context, picked = nil, opened = nil }, { __index = Lists })
    function catalog:boardAddPickedShelf(source) self.picked = source end
    function catalog:loadBooks(params, title) self.opened = { params = params, title = title } end
    function catalog:paramsForEntry(section, entry) return { section = section, id = entry.id } end
    return catalog
end

-- The pick pages are the real list pages.
assertEqual(Lists.listKind(nil, { kind = "section", section = "authors", dashboard_source_index = "board" }), "authors", "picking an author shows the Authors page")
assertEqual(Lists.listKind(nil, { kind = "section", section = "shelves", dashboard_source_index = "board" }), "shelves", "picking a shelf shows the Shelves page")

local catalog = catalogIn({ kind = "section", section = "authors", dashboard_source_index = "board" })
catalog:listRun({ kind = "open-author", entry = { id = 7, title = "Neil Gaiman" } })
assertEqual(catalog.picked.type, "authors", "a tapped author becomes the shelf's source")
assertEqual(catalog.picked.sourceName, "Neil Gaiman", "named after the author")
assertEqual(catalog.picked.params.id, 7, "with the author's catalog filter")
assertEqual(catalog.opened, nil, "and the author page does not open")

catalog = catalogIn({ kind = "section", section = "shelves", dashboard_source_index = "board" })
catalog:listRun({ kind = "open-shelf", shelf = { id = 3, title = "Autumn Reads", section = "collections" } })
assertEqual(catalog.picked.type, "collections", "a tapped collection keeps its own kind")
assertEqual(catalog.picked.sourceName, "Autumn Reads", "named after the collection")

catalog = catalogIn({ kind = "section", section = "series" })
catalog:listRun({ kind = "open-series", entry = { id = 4, title = "Discworld" } })
assertEqual(catalog.picked, nil, "outside pick mode nothing becomes a shelf")
assertEqual(catalog.opened.title, "Discworld", "the series opens as usual")

print("bookorbit_shelf_pick_test.lua: ok")
