-- Proves what a dashboard refresh fetches for the widget board: one request
-- for the body, one per distinct shelf the board shows, name lists only when a
-- link widget draws them, and how a failing or unsupported source degrades.

local connected = true

package.loaded["gettext"] = function(text)
    return text
end
package.loaded["ui/widget/infomessage"] = {
    new = function(_, opts)
        return opts or {}
    end,
}
package.loaded["ui/network/manager"] = {
    isConnected = function()
        return connected
    end,
}
local shown = {}
package.loaded["ui/uimanager"] = {
    show = function(_, widget)
        table.insert(shown, widget)
    end,
}
-- Messages are BookOrbit's pills; record them like any other shown widget.
package.loaded["bookorbit_toast"] = {
    show = function(text) table.insert(shown, { text = text }) end,
    error = function(text) table.insert(shown, { text = text }) end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDashboard = require("bookorbit_catalog_dashboard")
local Capabilities = require("bookorbit_capabilities")
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local requests
local last_books_params

local function newCatalog(opts)
    opts = opts or {}
    requests = {}
    last_books_params = nil
    local catalog = {
        title = "BookOrbit",
        settings = { catalog_dashboard_cache = opts.cache },
        client = {
            server_url = "https://example.test",
            username = "reader",
            catalogDashboard = function()
                table.insert(requests, "dashboard")
                if opts.dashboard_error then return nil, opts.dashboard_error end
                local body = { continueReading = { { id = 1 } }, finishedThisYear = opts.finished }
                if not opts.omit_discover then body.discover = { { id = 2 } } end
                return body
            end,
            catalogBooks = function(_, params)
                table.insert(requests, "books:" .. tostring(params.sort))
                last_books_params = params
                if opts.books_error and opts.books_error[params.sort] then
                    return nil, opts.books_error[params.sort]
                end
                local ids = { recently_added = 11, recently_read = 12, title = 13 }
                return { items = { { id = ids[params.sort] or 9 } } }
            end,
            catalogDiscover = function()
                table.insert(requests, "discover")
                return { discover = { { id = 14 } } }
            end,
            catalogDashboardSection = function(_, section_type)
                table.insert(requests, "section:" .. tostring(section_type))
                if opts.section_error then return nil, opts.section_error end
                return { section = { type = section_type, books = { { id = 21 } } } }
            end,
            catalogSection = function(_, section, params)
                table.insert(requests, "names:" .. section .. ":" .. tostring(params.size))
                return { items = { { title = "Autumn Reads" }, { title = 7 } } }
            end,
        },
    }
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then catalog[name] = fn end
    end
    function catalog:boardSources()
        return opts.sources or {}, opts.names or {}
    end
    function catalog:persistSetting(key, value)
        self.settings[key] = value
    end
    function catalog:fetch(_, fn)
        return fn()
    end
    function catalog:rootItems()
        return { { kind = "root-entry" } }
    end
    function catalog:showServerError(err)
        self.server_error = err
    end
    return catalog
end

local function count(prefix)
    local n = 0
    for _, request in ipairs(requests) do
        if request:find(prefix, 1, true) == 1 then n = n + 1 end
    end
    return n
end

-- A board with no shelves or name lists costs one request.
local catalog = newCatalog{}
local _, context = catalog:dashboardRoot()
assertEqual(#requests, 1, "a board without shelves costs a single request")
assertEqual(context.kind, "dashboard", "the body opens the dashboard")
assertEqual(next(context.dashboard.boardShelves), nil, "no shelves are stored when the board shows none")
assertEqual(catalog.settings.catalog_dashboard_cache, context.dashboard, "the body is cached for offline opens")

-- Discover and In progress come from the body already fetched; other shelves
-- cost one request each and are stored under their shelf key.
catalog = newCatalog{
    sources = {
        random = { source = "random" },
        ["in-progress"] = { source = "in-progress" },
        ["recently-added"] = { source = "recently-added" },
        ["authors:author=Le Guin"] = { source = "authors", params = { author = "Le Guin", sort = "title" } },
    },
}
_, context = catalog:dashboardRoot()
local shelves = context.dashboard.boardShelves
assertEqual(#requests, 3, "two catalog shelves cost two requests beside the body")
assertEqual(count("discover"), 0, "Discover is served from the body")
assertEqual(shelves.random[1].id, 2, "Discover holds the body's list")
assertEqual(shelves["in-progress"][1].id, 1, "In progress holds Continue reading")
assertEqual(shelves["recently-added"][1].id, 11, "Recently added loads from catalog books")
assertEqual(shelves["authors:author=Le Guin"][1].id, 13, "a picked author loads with its filter")
assertEqual(last_books_params.size, 12, "a shelf requests a full page of books")
assertEqual(last_books_params.page, 1, "a shelf requests its first page")

-- Pick back up is the in-progress list oldest first; Finished this year comes
-- with the dashboard body and costs no request.
catalog = newCatalog{
    finished = { { id = 40 } },
    sources = { ["pick-back-up"] = { source = "pick-back-up" }, finished = { source = "finished" } },
}
_, context = catalog:dashboardRoot()
assertEqual(#requests, 2, "only Pick back up costs a request")
assertEqual(last_books_params.readStatus, "reading", "Pick back up lists books in progress")
assertEqual(last_books_params.sort .. " " .. last_books_params.order, "recently_read asc", "oldest read first")
assertEqual(context.dashboard.boardShelves.finished[1].id, 40, "finished books come from the body")
catalog = newCatalog{ sources = { finished = { source = "finished" } } }
_, context = catalog:dashboardRoot()
assertEqual(#context.dashboard.boardShelves.finished, 0, "an older server leaves the shelf empty")

-- Without a preloaded list, Discover falls back to the dedicated endpoint.
catalog = newCatalog{ omit_discover = true, sources = { random = { source = "random" } } }
_, context = catalog:dashboardRoot()
assertEqual(requests[2], "discover", "a missing discover list falls back to catalogDiscover")
assertEqual(context.dashboard.boardShelves.random[1].id, 14, "the fallback fills the Discover shelf")

-- A failed shelf is drawn empty; the rest of the board still loads.
catalog = newCatalog{
    books_error = { recently_added = 500 },
    sources = {
        ["recently-added"] = { source = "recently-added" },
        ["authors:author=Le Guin"] = { source = "authors", params = { author = "Le Guin" } },
    },
}
_, context = catalog:dashboardRoot()
assertEqual(#context.dashboard.boardShelves["recently-added"], 0, "the failed shelf degrades to an empty list")
assertEqual(context.dashboard.boardShelves["authors:author=Le Guin"][1].id, 9, "later shelves continue loading")

-- Name lists are fetched only when a link widget draws them, four at most, and
-- keep only string titles.
catalog = newCatalog{ names = { collections = true } }
_, context = catalog:dashboardRoot()
assertEqual(requests[2], "names:collections:4", "the collections link fetches four names")
assertEqual(count("names:"), 1, "SmartScope names are not fetched when no link shows them")
assertEqual(#context.dashboard.boardNames.collections, 1, "non-string titles are dropped")

-- Server-composed shelves go through the section endpoint. A confirmed 404
-- empties the shelf and records the missing capability, so later refreshes
-- skip the endpoint entirely.
Capabilities.reset()
catalog = newCatalog{
    sources = {
        ["want-to-read"] = { source = "want-to-read" },
        ["up-next-in-series"] = { source = "up-next-in-series" },
    },
}
_, context = catalog:dashboardRoot()
assertEqual(count("section:"), 2, "each server-composed shelf costs one request")
assertEqual(context.dashboard.boardShelves["want-to-read"][1].id, 21, "the section's books land in the shelf")

Capabilities.reset()
catalog = newCatalog{ section_error = 404, sources = { ["want-to-read"] = { source = "want-to-read" } } }
_, context = catalog:dashboardRoot()
assertEqual(#context.dashboard.boardShelves["want-to-read"], 0, "an unsupported section degrades to an empty shelf")
assertEqual(Capabilities.cached(catalog.client)[DashboardSections.SECTION_ENDPOINT_CAPABILITY], false,
    "a confirmed 404 records the missing capability")
requests = {}
catalog:dashboardRoot()
assertEqual(count("section:"), 0, "a known-missing capability skips the section endpoint")
Capabilities.reset()

-- A refresh that is no longer current stops before fetching more shelves.
catalog = newCatalog{ sources = { ["recently-added"] = { source = "recently-added" } } }
local items
items, context = catalog:dashboardRoot({ is_current = function() return false end })
assertEqual(items, nil, "a superseded refresh returns nothing")
assertEqual(context, "cancelled", "a superseded refresh reports it was cancelled")
assertEqual(count("books:"), 0, "a superseded refresh fetches no shelves")

-- A server without the dashboard falls back to the catalog root.
shown = {}
catalog = newCatalog{ dashboard_error = 404 }
items, context = catalog:dashboardRoot()
assertEqual(context.kind, "root", "an unsupported dashboard opens the catalog root")
assertEqual(#shown, 1, "the reader is told why")

-- A failed refresh keeps the cached body; without one the board says so.
catalog = newCatalog{ dashboard_error = 500, cache = { continueReading = {} } }
_, context = catalog:dashboardRoot()
assertEqual(context.dashboard, catalog.settings.catalog_dashboard_cache, "a failed refresh keeps the cache")
assertEqual(context.stale, true, "the cached body is marked stale")
catalog = newCatalog{ dashboard_error = 500 }
_, context = catalog:dashboardRoot()
assertEqual(context.unavailable, true, "without a cache the board shows it could not load")
assertEqual(catalog.server_error, 500, "the server error is reported")

-- Every book the board can draw is prefetched once, whichever list it is in.
local books = CatalogDashboard.dashboardBooks({
    continueReading = { { id = 1 } },
    boardShelves = { random = { { id = 2 }, { id = 1 } }, recent = { { id = 3 } } },
    discover = { { id = 2 } },
    yearAgo = { book = { id = 4 } },
})
assertEqual(#books, 4, "books shared between lists are prefetched once")
assertEqual(#CatalogDashboard.dashboardBooks(nil), 0, "no body yields no books")

print("bookorbit_catalog_dashboard_section_test.lua: ok")
