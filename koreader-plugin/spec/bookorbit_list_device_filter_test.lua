package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text, value) return (text:gsub("%%1", value or "")) end }
package.loaded["document/documentregistry"] = {}
package.loaded["util"] = {}
for _, name in ipairs({ "device", "ui/widget/infomessage", "ui/network/manager", "ui/uimanager",
    "datetime", "logger", "bookorbit_board_data", "bookorbit_board_metrics",
    "bookorbit_capabilities", "bookorbit_list_cache", "bookorbit_list_data",
    "bookorbit_list_pages", "bookorbit_list_view" }) do package.loaded[name] = {} end
local Lists = require("bookorbit_catalog_lists")
local captured
local catalog = setmetatable({ on_device = { [2] = "second", [1] = "first" } }, { __index = Lists })
function catalog:runConnected(fn) fn() end
function catalog:persistSetting() end
function catalog:fetchBookPage(params, title)
    captured = { params = params, title = title }
    self.current_context = { kind = "books", params = params, title = title, on_device_filter = params.on_device_filter }
end
catalog.loadBooks = catalog.fetchBookPage
catalog.current_context = { kind = "books", title = "On device", on_device_filter = true,
    params = { sort = "title", ids = "1,2", on_device_filter = true },
    list_sheet = { kind = "sort", staged = { sort = "title", order = "asc", on_device = false } } }
catalog:listApplySheet()
assert(captured.title == "Library", "removing device filter restores Library title")
assert(captured.params.ids == nil and captured.params.on_device_filter == nil, "removing filter clears both IDs and context")
catalog.current_context.list_sheet = { kind = "sort", staged = { sort = "title", order = "asc", on_device = true } }
catalog:listApplySheet()
assert(captured.params.ids == "1,2" and captured.params.on_device_filter == true, "adding filter preserves device context with sorted IDs")
catalog:listReload({ page = 2 })
assert(captured.params.on_device_filter == true, "pagination retains device context")
catalog.current_context.title = "On device"
catalog:listRun({ kind = "clear-filters" })
assert(captured.title == "Library", "clear filters restores Library title")
assert(captured.params.ids == nil and captured.params.on_device_filter == nil, "clear filters removes local and server device filters")
G_reader_settings = { isTrue = function() return false end }
package.loaded["datetime"].secondsToHour = function() return "12:00" end
package.loaded["bookorbit_list_data"].bookCount = function() return "129 books" end
function catalog:isBulkSelectionActive() return false end
local oldest = catalog:listHeader("reading", { total = 129, params = { sort = "recently_read", order = "asc" } })
assert(oldest.sub == "129 books · oldest read first", "Pick back up subtitle agrees with ascending last-read order")
local newest = catalog:listHeader("reading", { total = 129, params = { sort = "recently_read" } })
assert(newest.sub == "129 books · last read first", "default reading list retains newest-first subtitle")
function catalog:effectiveOrder(params)
    return params.order or (params.sort == "recently_added" and "desc" or "asc")
end
assert(catalog:listHeader("books", { params = { sort = "title", order = "desc" } }).sub == "129 books · Title Z–A",
    "book header reflects descending title order")
assert(catalog:listHeader("books", { params = { sort = "author", order = "desc" } }).sub == "129 books · Author Z–A",
    "book header reflects descending author order")
assert(catalog:listHeader("books", { params = { sort = "recently_added", order = "asc" } }).sub == "129 books · Recently added (oldest)",
    "book header reflects oldest-first time order")
local empty_search = catalog:listEmptyModel("authors", { q = "No matching author" })
assert(empty_search.icon == "search" and empty_search.title == "Nothing matches “No matching author”",
    "an empty section search describes its query rather than an empty library")
function catalog:listKind() return "books" end
function catalog:listLibraries() return {} end
local model = catalog:listSortSheetModel({ staged = { sort = "title", order = "asc" } })
local download_action
for _, row in ipairs(model.rows) do
    if row.key == "download" then download_action = row.action end
end
assert(download_action, "current list sheet exposes the existing download actions")
local opened_downloads, opened_selection = false, false
function catalog:listCloseSheet() self.current_context.list_sheet = nil end
function catalog:showDownloadActions() opened_downloads = true end
function catalog:showBulkSelectionActions() opened_selection = true end
catalog.current_context.list_sheet = { kind = "sort" }
catalog:listRun(download_action)
assert(opened_downloads and catalog.current_context.list_sheet == nil,
    "download entry closes the list sheet before opening scoped actions")
catalog:listRun({ kind = "select-menu" })
assert(opened_selection, "selection menu opens page and clear actions")
print("bookorbit_list_device_filter_test.lua: ok")
