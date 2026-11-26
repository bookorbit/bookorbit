-- Issue 2361: On device lists books that are already on the device, so offline
-- it must never ask for a connection (which turns Wi-Fi on or prompts, by the
-- reader's KOReader policy). Offline it is built here, from saved list pages
-- and the book files, and paged here; only the offline band's tap, or an open
-- while connected, reaches the server. A server that cannot be reached falls
-- back to the same list instead of an error.

package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    diskUsage = function() return { total = 1, available = 1 } end,
}
package.loaded["datetime"] = {
    shortDayOfWeekToLongTranslation = {},
    shortDayOfWeekTranslation = {},
    longMonthTranslation = {},
    shortMonthTranslation = {},
    secondsToHour = function() return "12:00" end,
    stringISO8601ToSeconds = function() return nil end,
}
package.loaded["device"] = { hasFrontlight = function() return false end }
local connected = false
local NetworkMgr = { isConnected = function() return connected end }
package.loaded["ui/network/manager"] = NetworkMgr
package.loaded["bookorbit_stats_reader"] = {
    getDailySeconds = function() return {} end,
    getBookPace = function() return nil end,
    getHourMinutes = function() return nil end,
    getSessionRecords = function() return nil end,
}
package.loaded["lua-ljsqlite3/init"] = false
package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end }
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
G_reader_settings = { isTrue = function() return false end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local OnDeviceOffline = require("bookorbit_on_device_offline")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function titles(items)
    local out = {}
    for _i, book in ipairs(items or {}) do table.insert(out, book.title) end
    return table.concat(out, "|")
end

-- ---------------------------------------------------------------- builder
local ids = OnDeviceOffline.parseIds("3,1,x,3,2")
assertEqual(table.concat(ids, ","), "3,1,2", "ids are read in order, once each, skipping junk")
assertEqual(#OnDeviceOffline.parseIds(nil), 0, "no ids is an empty list")

local opened = OnDeviceOffline.fileEntry(7, "/books/Standalone/Szalay - Flesh.epub", { title = " Flesh ", authors = "David Szalay\nSecond Author" })
assertEqual(opened.id, 7, "the entry keeps its book id")
assertEqual(opened.title, "Flesh", "a book KOReader has read uses its title")
assertEqual(table.concat(opened.authors, ";"), "David Szalay;Second Author", "and its authors, one per line")
assertEqual(opened.formats[1], "epub", "the format comes from the file")
assertEqual(opened.hasCover, false, "no cover is asked for, since none was saved")
local unopened = OnDeviceOffline.fileEntry(8, "/books/Darcy Coates - From Below.EPUB", nil)
assertEqual(unopened.title, "Darcy Coates - From Below", "an unopened book is named by its file")
assertEqual(#unopened.authors, 0, "with no authors to guess")
assertEqual(unopened.formats[1], "epub", "formats are lower case")

local entries = {
    { id = 5, title = "the Zebra" },
    { id = 2, title = "apple" },
    { id = 9, title = "Éclair" },
    { id = 4, title = "42 Stories" },
    { id = 1, title = "Banana" },
    { id = 6, title = "Apple" },
}
local body = OnDeviceOffline.body(entries, { page = 1 }, 2)
assertEqual(titles(body.items), "42 Stories|apple", "sorted by letter group, then title ignoring case, then id")
assertEqual(body.total, 6, "the total counts every book")
assertEqual(body.size, 2, "pages hold a screen")
assertEqual(body.hasNext, true, "more pages follow")
assertEqual(body.hasPrevious, false, "the first page has none before it")
local keys = {}
for _i, b in ipairs(body.buckets) do table.insert(keys, b.key .. "@" .. b.index) end
assertEqual(table.concat(keys, ","), "#@0,A@1,B@3,E@4,T@5", "the rail's letters point at their first book, accents folded")
assertEqual(#entries, 6, "the caller's entries are not reordered")
assertEqual(entries[1].title, "the Zebra", "the caller's order is kept")

body = OnDeviceOffline.body(entries, { page = 3 }, 2)
assertEqual(titles(body.items), "Éclair|the Zebra", "a page number pages through the sorted list")
assertEqual(body.hasNext, false, "the last page has nothing after it")
assertEqual(body.offset, nil, "a paged request answers without an offset")

body = OnDeviceOffline.body(entries, { page = 1, offset = 3 }, 2)
assertEqual(titles(body.items), "Banana|Éclair", "an offset starts the screen there, as a letter jump asks")
assertEqual(body.offset, 3, "and is answered back")
assertEqual(body.hasPrevious, true, "books before it can be paged back to")

body = OnDeviceOffline.body({}, { page = 1 }, 12)
assertEqual(body.total, 0, "no books is an empty list, not an error")
assertEqual(#body.items, 0, "with no items")

-- --------------------------------------------------------- catalog wiring
for _, name in ipairs({ "ui/widget/infomessage", "ui/uimanager", "logger", "bookorbit_board_metrics",
    "bookorbit_list_pages", "bookorbit_list_view" }) do
    package.loaded[name] = package.loaded[name] or {}
end
package.loaded["logger"].warn = function() end
local capabilities = { catalogListsV2 = true }
package.loaded["bookorbit_capabilities"] = { cached = function() return capabilities end }
local saved_books = {}
local asked_account, asked_ids
package.loaded["bookorbit_list_cache"] = {
    books = function(account, want)
        asked_account, asked_ids = account, want
        return saved_books
    end,
}
local sidecars = {}
package.loaded["docsettings"] = {
    hasSidecarFile = function(_, path) return sidecars[path] ~= nil end,
    open = function(_, path)
        return { readSetting = function(_, key) return key == "doc_props" and sidecars[path] or nil end }
    end,
}

local Lists = require("bookorbit_catalog_lists")
local paths = { [1] = "/b/Dune.epub", [2] = "/b/Emma Woodhouse - Emma.epub", [3] = "/b/Ulysses.epub" }
local capacity_opts
local catalog = setmetatable({ client = { server_url = "https://books.example", username = "reader" } }, { __index = Lists })
function catalog:onDeviceBookPath(book) return paths[book.id] end
function catalog:listCapacity(_kind, _view, _params, opts) capacity_opts = opts; return 2 end
function catalog:listView() return "grid" end

saved_books = { [1] = { id = 1, title = "Dune", hasCover = true } }
sidecars["/b/Ulysses.epub"] = { title = "Ulysses", authors = "James Joyce" }
body = catalog:listOnDeviceOfflineBody({ ids = "1,2,3,4", page = 1, on_device_filter = true })
assertEqual(asked_account, "https://books.example|reader", "saved pages are read for this account")
assertEqual(asked_ids[4], nil, "a book whose file is gone is not looked up")
assertEqual(body.total, 3, "a book whose file is gone is not listed")
assertEqual(capacity_opts and capacity_opts.offline, true, "pages are sized for the offline band")
assertEqual(titles(body.items), "Dune|Emma Woodhouse - Emma", "the first screen, by title")
assertEqual(body.items[1].hasCover, true, "a saved book keeps its saved entry, cover and all")
body = catalog:listOnDeviceOfflineBody({ ids = "1,2,3", page = 2, on_device_filter = true })
assertEqual(body.items[1].title, "Ulysses", "a book KOReader has read uses its metadata")
assertEqual(body.items[1].authors[1], "James Joyce", "with its authors")
assertEqual(body.buckets ~= nil, true, "a current server's rail gets its letters")
capabilities = {}
body = catalog:listOnDeviceOfflineBody({ ids = "1", page = 1, on_device_filter = true })
assertEqual(body.buckets, nil, "an older server's list draws no rail, so it gets no letters")
capabilities = { catalogListsV2 = true }

-- The offline band's tap is the reader asking to reach the server.
local reloaded
function catalog:loadBooks(params, title, push, opts) reloaded = { params = params, push = push, opts = opts } end
catalog.current_context = { kind = "books", title = "On device", page = 2, list_offline = true,
    params = { ids = "1,2,3", on_device_filter = true, sort = "title" } }
catalog:listRun({ kind = "reconnect" })
assertEqual(reloaded and reloaded.opts and reloaded.opts.connect, true, "the band's tap asks for a connection")
assertEqual(reloaded.params.page, 2, "and reloads the page on screen")
catalog:listReload({ page = 1 })
assertEqual(reloaded.opts.connect, nil, "a plain reload does not")

-- ------------------------------------------------------------- routing
-- loadBooks, showOnDeviceOffline and fetchBookPage are lifted out of the
-- catalog, which cannot be loaded whole outside KOReader.
local source
do
    local file = assert(io.open("koreader-plugin/bookorbit.koplugin/bookorbit_catalog.lua", "rb"))
    source = file:read("*a")
    file:close()
end
local function cloneParams(params)
    local out = {}
    for key, value in pairs(params or {}) do out[key] = value end
    return out
end
local env = { BookOrbitCatalog = {}, NetworkMgr = NetworkMgr, cloneParams = cloneParams,
    _ = function(text) return text end, T = package.loaded["ffi/util"].template,
    math = math, type = type, pairs = pairs, ipairs = ipairs, tostring = tostring }
for _, name in ipairs({ "fetchBookPage", "loadBooks", "showOnDeviceOffline" }) do
    local fn = assert(source:match("\n(function BookOrbitCatalog:" .. name .. "%(.-\nend)\n"), name .. " is defined in the catalog")
    local chunk = assert(loadstring(fn, name))
    setfenv(chunk, env)
    chunk()
end

local calls
local fetch_result
local saved_page
local router = {}
for name, fn in pairs(env.BookOrbitCatalog) do router[name] = fn end
function router:runConnected(fn) table.insert(calls, "connected"); fn() end
function router:listEnsureCapabilities() end
function router:listBookPageSize() return 12 end
function router:listDecorateBookQuery(query) return query end
function router:effectiveOrder() return "asc" end
function router:fetch() table.insert(calls, "fetch"); return fetch_result.body, fetch_result.err end
function router:listSavedPage(_query, err) if type(err) == "number" then return nil end return saved_page end
function router:listSavePage() end
function router:listFetchCompleteSeries(_query, b) return b end
function router:showRetry(err) table.insert(calls, "retry:" .. tostring(err)) end
function router:listOnDeviceOfflineBody(query) table.insert(calls, "local"); return { items = {}, total = 0, query = query } end
local shown
function router:showBookPage(b, query, title, push, opts) shown = { body = b, query = query, title = title, push = push, opts = opts } end

local on_device = { ids = "3,1", sort = "author", readStatus = "reading", libraryId = 4, format = "epub", page = 2, on_device_filter = true }

-- Offline, On device is built here and nothing asks for a connection.
connected, calls, shown = false, {}, nil
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "local", "offline On device never waits for a connection")
assertEqual(shown.title, "On device", "the list keeps its title")
assertEqual(shown.push, true, "and opens as a new page")
assertEqual(shown.opts.offline_saved_at, 0, "it is drawn as an offline list, with the band")
assertEqual(shown.query.ids, "3,1", "it lists the same books")
assertEqual(shown.query.page, 2, "on the same page")
assertEqual(shown.query.sort, "title", "by title, the order the device can give")
assertEqual(shown.query.readStatus, nil, "without a status filter the device cannot apply")
assertEqual(shown.query.libraryId, nil, "or a library filter")
assertEqual(shown.query.format, nil, "or a format filter")
router:loadBooks(on_device, "On device", false)
assertEqual(shown.push, false, "a page turn replaces the page")

-- The band's tap asks, by the reader's Wi-Fi policy.
calls = {}
fetch_result = { body = { items = {}, total = 0 } }
router:loadBooks(on_device, "On device", false, { connect = true })
assertEqual(calls[1], "connected", "an explicit reconnect waits for a connection")

-- Every other list still needs the server.
calls = {}
router:loadBooks({ sort = "title" }, "Library", true)
assertEqual(calls[1], "connected", "other lists still ask for a connection offline")

-- Connected, On device comes from the server as before.
connected, calls = true, {}
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "connected,fetch", "connected, On device is fetched")
assertEqual(shown.opts.offline_saved_at, nil, "and drawn as a live list")

-- Connected but the server cannot be reached: the saved page, else the list built here.
calls, saved_page = {}, nil
fetch_result = { err = "timeout" }
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "connected,fetch,local", "an unreachable server falls back to the list built here")
calls, saved_page = {}, { body = { items = {}, total = 0 }, saved_at = 5 }
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "connected,fetch", "a page saved for the same request comes first")
assertEqual(shown.opts.offline_saved_at, 5, "and says when it was saved")
calls, saved_page = {}, nil
fetch_result = { err = 401 }
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "connected,fetch,retry:401", "a server that answered with an error is not hidden")
calls = {}
fetch_result = { err = "cancelled" }
router:loadBooks(on_device, "On device", true)
assertEqual(table.concat(calls, ","), "connected,fetch", "a cancelled request shows nothing")
calls = {}
fetch_result = { err = "timeout" }
router:loadBooks({ sort = "title" }, "Library", true)
assertEqual(table.concat(calls, ","), "connected,fetch,retry:timeout", "another list without a saved page still offers a retry")

print("bookorbit_on_device_offline_test.lua: ok")
