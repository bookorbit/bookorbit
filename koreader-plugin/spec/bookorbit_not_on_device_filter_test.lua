-- "Not on this device" is a choice in the list's Sort and filter sheet. Which books
-- are here is local KOReader state, so the device sends the whole set for the
-- server to leave out, read fresh for every request rather than when the filter
-- was chosen, and only to a server that advertises the body query.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text, value) return (text:gsub("%%1", value or "")) end }
package.loaded["document/documentregistry"] = {}
package.loaded["util"] = {}
for _, name in ipairs({ "device", "ui/widget/infomessage", "ui/network/manager", "ui/uimanager",
    "datetime", "logger", "bookorbit_board_data", "bookorbit_board_metrics",
    "bookorbit_list_cache", "bookorbit_list_data", "bookorbit_list_pages", "bookorbit_list_view" }) do
    package.loaded[name] = {}
end

local capabilities = { catalogListsV2 = true, catalogBooksQuery = true }
package.loaded["bookorbit_capabilities"] = { cached = function() return capabilities end }
local toasts = {}
package.loaded["bookorbit_toast"] = { show = function(text) table.insert(toasts, text) end }

local Lists = require("bookorbit_catalog_lists")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- Book 7's file is gone, so it is no longer on the device whatever the map says.
local files = { [12] = true, [3] = true, [40] = true }
local maps_ready = true
local captured, redrawn
local catalog = setmetatable({ on_device = { [40] = "c", [3] = "a", [12] = "b", [7] = "gone" } }, { __index = Lists })
function catalog:refreshOnDevice() return maps_ready end
function catalog:isOnDevice(book) return files[book.id] == true end
function catalog:runConnected(fn) fn() end
function catalog:persistSetting() end
function catalog:updateItems() redrawn = true end
function catalog:fetchBookPage(params, title)
    local query = {}
    for key, value in pairs(params) do query[key] = value end
    self:listDecorateBookQuery(query)
    captured = { params = params, query = query, title = title }
    self.current_context = { kind = "books", params = params, title = title,
        on_device_filter = params.on_device_filter, not_on_device_filter = params.not_on_device_filter }
end
local function openSheet(context, staged)
    context.kind = "books"
    context.list_sheet = { kind = "sort", staged = staged }
    catalog.current_context = context
end

-- Choosing it from All books keeps the list and its title, and sets only the flag:
-- the exclusion itself is read when the request is built.
openSheet({ title = "All books", params = { sort = "title" } }, { sort = "title", order = "asc", device = "off" })
catalog:listApplySheet()
assertEqual(captured.title, "All books", "the list keeps its title")
assertEqual(captured.params.not_on_device_filter, true, "the list remembers the filter")
assertEqual(captured.params.on_device_filter, nil, "the two device filters never combine")
assertEqual(captured.params.excludeIds, nil, "the stored list holds no stale set")
assertEqual(captured.query.excludeIds, "3,12,40", "the request leaves out every book here, sorted, skipping missing files")
assertEqual(catalog.current_context.not_on_device_filter, true, "the page knows it is filtered")

-- From the On device list it swaps the ids filter for the exclusion and goes back to Library.
openSheet({ title = "On device", on_device_filter = true, params = { sort = "title", ids = "3,12", on_device_filter = true } },
    { sort = "title", order = "asc", device = "off" })
catalog:listApplySheet()
assertEqual(captured.title, "Library", "leaving On device restores the Library title")
assertEqual(captured.params.ids, nil, "the On device ids are dropped")
assertEqual(captured.query.excludeIds, "3,12,40", "the exclusion replaces them")

-- A reload reads the device again, so a book downloaded from the list drops out of it.
files[7] = true
catalog:fetchBookPage(captured.params, captured.title)
assertEqual(captured.query.excludeIds, "3,7,12,40", "a newly downloaded book is excluded on the next load")
local stale = { not_on_device_filter = true, excludeIds = "1" }
files = {}
catalog:listDecorateBookQuery(stale)
assertEqual(stale.excludeIds, nil, "with nothing on the device nothing is left out")
local plain = { sort = "title" }
catalog:listDecorateBookQuery(plain)
assertEqual(plain.excludeIds, nil, "an unfiltered list never carries an exclusion")
files = { [12] = true, [3] = true, [40] = true }

-- While the device's books are still being found, every book would read as missing.
captured, redrawn = nil, false
maps_ready = false
openSheet({ title = "All books", params = { sort = "title" } }, { sort = "title", order = "asc", device = "off" })
catalog:listApplySheet()
assertEqual(captured, nil, "no list is loaded before the device is known")
assertEqual(toasts[#toasts], "Still checking which books are on this device", "the reader is told why")
assertEqual(redrawn, true, "the sheet closes")
maps_ready = true

-- Choosing Any clears it again.
openSheet({ title = "All books", not_on_device_filter = true, params = { sort = "title", not_on_device_filter = true, excludeIds = "3" } },
    { sort = "title", order = "asc" })
catalog:listApplySheet()
assertEqual(captured.params.not_on_device_filter, nil, "Any clears the filter")
assertEqual(captured.query.excludeIds, nil, "and the exclusion with it")

-- The sheet opens on the current choice and offers it only when the server can serve it.
function catalog:listKind() return "books" end
function catalog:listLibraries() return {} end
catalog.current_context = { kind = "books", not_on_device_filter = true, params = { sort = "title", not_on_device_filter = true } }
catalog:listOpenSheet("sort")
local sheet = catalog.current_context.list_sheet
assertEqual(sheet.staged.device, "off", "the sheet opens on Not on this device")
local device_row
for _, row in ipairs(catalog:listSortSheetModel(sheet).rows) do
    if row.key == "device" then device_row = row end
end
assertEqual(device_row.value, "Not on this device", "the row names the choice")
assertEqual(device_row.action.pick, "device", "the row opens the device choices")

local function pickLabels(staged)
    local labels = {}
    for _, option in ipairs(catalog:listSortSheetModel({ pick = "device", staged = staged }).options) do
        table.insert(labels, option.label)
    end
    return table.concat(labels, "|")
end
assertEqual(pickLabels({ sort = "title" }), "Any|On this device|Not on this device", "a current server offers all three")
capabilities = { catalogListsV2 = true }
assertEqual(pickLabels({ sort = "title" }), "Any|On this device", "an older server is not offered a list it cannot build")
capabilities = { catalogListsV2 = true, catalogBooksQuery = true }

sheet.pick = "device"
catalog:listRun({ kind = "sheet-pick", value = "on" })
assertEqual(sheet.staged.device, "on", "picking a choice stages it")
sheet.pick = "device"
catalog:listRun({ kind = "sheet-pick", value = false })
assertEqual(sheet.staged.device, nil, "Any stages no device filter")

-- The toolbar and the empty page say what the list is.
local toolbar = catalog:listToolbar("books", { not_on_device_filter = true, params = { readStatus = "unread" } })
assertEqual(toolbar[2].label, "Unread · Not on device", "the filter button names both filters")
assertEqual(toolbar[2].on, true, "the filter button shows a filter is on")
local empty = catalog:listEmptyModel("books", { not_on_device_filter = true, params = {} })
assertEqual(empty.title, "Every book here is on this device", "an empty list says why it is empty")
assertEqual(empty.action.action.kind, "clear-filters", "and offers the way out")

-- Clearing filters drops the flag and any exclusion it left behind.
local reload
function catalog:listReload(opts) reload = opts end
catalog.current_context = { kind = "books", not_on_device_filter = true, params = { not_on_device_filter = true, excludeIds = "3" } }
catalog:listRun({ kind = "clear-filters" })
assertEqual(catalog.current_context.not_on_device_filter, nil, "the page is no longer filtered")
local cleared = table.concat(reload.clear, ",")
assertEqual(cleared:find("not_on_device_filter", 1, true) ~= nil and cleared:find("excludeIds", 1, true) ~= nil, true,
    "the reload drops the flag and the exclusion")

print("bookorbit_not_on_device_filter_test.lua: ok")
