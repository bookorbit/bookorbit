package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text, value) return (text:gsub("%%1", value or "")) end }
package.loaded["document/documentregistry"] = {}
package.loaded["util"] = {}
for _, name in ipairs({ "device", "ui/widget/infomessage", "ui/network/manager", "ui/uimanager",
    "datetime", "logger", "bookorbit_board_data", "bookorbit_board_metrics",
    "bookorbit_list_cache", "bookorbit_list_data",
    "bookorbit_list_pages", "bookorbit_list_view" }) do package.loaded[name] = {} end

local Lists = require("bookorbit_catalog_lists")
local Capabilities = require("bookorbit_capabilities")

local requested, saved = {}, {}
local catalog = setmetatable({
    client = {
        catalogBooks = function(_, query)
            table.insert(requested, query.page)
            local first = (query.page - 1) * 100 + 1
            local last = math.min(135, first + 99)
            local items = {}
            for id = first, last do table.insert(items, { id = id, title = string.format("Volume %03d", id) }) end
            return { items = items, total = 135, page = query.page, size = 100, hasNext = last < 135 }
        end,
    },
}, { __index = Lists })
function catalog:fetch(_label, fn) return fn() end
function catalog:listSavePage(query) table.insert(saved, query.page) end
function catalog:listSavedPage() return nil end

local first = catalog.client:catalogBooks({ page = 1 })
local complete = assert(catalog:listFetchCompleteSeries({ page = 1, size = 100, seriesId = 42, sort = "title" }, first, "Series"))
assert(#complete.items == 135, "a series joins every API page")
assert(complete.items[101].title == "Volume 101", "the next page keeps title order")
assert(complete.hasNext == false and complete.nextUrl == nil, "the joined response is complete")
assert(#requested == 2 and requested[2] == 2, "only the missing page is requested")
assert(#saved == 1 and saved[1] == 2, "the added page is cached independently")

requested = {}
local ordinary = { items = { { id = 1 } }, total = 200, page = 1, size = 100, hasNext = true }
assert(catalog:listFetchCompleteSeries({ page = 1, size = 100, sort = "title" }, ordinary) == ordinary,
    "ordinary book lists keep server pagination")
assert(#requested == 0, "ordinary book lists do not fetch ahead")

local first_book = { id = 1, title = "First", seriesIndex = 1 }
local second_book = { id = 2, title = "Second", seriesIndex = 2 }
package.loaded["bookorbit_list_data"].stateOf = function() return "unread" end
package.loaded["bookorbit_list_pages"].seriesLayout = function()
    return { pages = 1, first = 2, rest = 2 }
end
function catalog:listScreen() return 600, 800 end
function catalog:listView() return "grid" end
function catalog:isBulkSelectionActive() return true end
function catalog:bulkIsBookSelected(book) return book.id == first_book.id end
function catalog:listMinutesLeft() return nil end
local _, model = catalog:listBody("seriespage", {
    books = { first_book, second_book },
    params = { seriesId = 42, sort = "title" },
    series_summary = { total = 2, finished = 0, reading = 0 },
})
assert(model.select == true, "a series page exposes active selection mode to its book cards")
assert(model.selected(first_book) == true, "a series page marks the selected book")
assert(model.selected(second_book) == false, "a series page leaves unselected books unmarked")

function catalog:updateItems() end
function catalog:runConnected(fn) return fn() end
local applied
function catalog:fetchBookPage(params, title, push) applied = { params = params, title = title, push = push } end

Capabilities.reset()
Capabilities.remember(catalog.client, { capabilities = { Lists.CAPABILITY, Lists.PUBLISHED_SORT_CAPABILITY } })
catalog.current_context = { kind = "books", title = "Series", params = { seriesId = 42, sort = "series", order = "asc" } }
catalog:listOpenSheet("sort", "sort")
local sheet_model = catalog:listSortSheetModel(catalog.current_context.list_sheet)
assert(table.concat(sheet_model.sorts.labels, "|") == "Series order|Publication date|Title|Last read|Added to library",
    "a capable server exposes every series sort")
assert(table.concat(sheet_model.order.labels, "|") == "First to last|Last to first", "series position has purpose-specific directions")

catalog:listRun({ kind = "sheet-sort", index = 2 })
assert(catalog.current_context.list_sheet.staged.sort == "published", "publication date can be selected")
assert(catalog.current_context.list_sheet.staged.order == "asc", "publication date starts oldest first")
catalog:listRun({ kind = "sheet-order", index = 2 })
catalog:listRun({ kind = "sheet-show", index = 2 })
catalog:listApplySheet()
assert(applied.params.sort == "published" and applied.params.order == "desc", "Apply reloads the series with the selected sorting")
assert(applied.params.readStatus == "unread", "Apply keeps read status as a filter")
assert(applied.params.page == 1 and applied.params.size == nil and applied.push == false, "Apply restarts the same series list")

Capabilities.remember(catalog.client, { capabilities = { Lists.CAPABILITY } })
catalog.current_context = { kind = "books", title = "Series", params = { seriesId = 42, sort = "series" } }
catalog:listOpenSheet("sort", "sort")
sheet_model = catalog:listSortSheetModel(catalog.current_context.list_sheet)
assert(table.concat(sheet_model.sorts.labels, "|") == "Series order|Title|Last read|Added to library",
    "an older server is never offered the unsupported publication sort")
catalog.current_context.list_sheet.staged = { sort = "title", order = "desc", readStatus = "finished" }
catalog:listResetSheet()
assert(catalog.current_context.list_sheet.staged.sort == "series" and catalog.current_context.list_sheet.staged.order == "asc",
    "Reset restores first-to-last series order")
assert(catalog.current_context.list_sheet.staged.readStatus == nil, "Reset clears the series filter")

local source_file = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_catalog.lua", "r"))
local source = source_file:read("*a")
source_file:close()
local params_source = assert(source:match("(function BookOrbitCatalog:paramsForEntry.-\nend)\n\n%-%- Assumes"))
local env = { BookOrbitCatalog = {} }
setmetatable(env, { __index = _G })
local chunk = assert(loadstring(params_source))
setfenv(chunk, env)
chunk()
local series_params = env.BookOrbitCatalog.paramsForEntry({}, "series", { seriesId = 42, id = "series:42" })
assert(series_params.seriesId == 42 and series_params.sort == "series", "opening a series defaults to membership order")

print("bookorbit_series_paging_test.lua: ok")
