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

print("bookorbit_series_paging_test.lua: ok")
