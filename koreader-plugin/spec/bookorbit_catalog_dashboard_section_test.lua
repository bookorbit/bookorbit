-- Proves the configurable dashboard row: how a stored choice degrades, when the
-- section parameter is put on the wire, and how a cached body fetched for a
-- different choice is treated.

local connected = true

package.loaded["document/documentregistry"] = {
    hasProvider = function()
        return true
    end,
}
package.loaded["util"] = {
    fixUtf8 = function(value)
        return value
    end,
    urlEncode = function(value)
        return value
    end,
}
package.loaded["ffi/util"] = {
    template = function(value)
        return value
    end,
}
package.loaded["gettext"] = function(text)
    return text
end

local function widgetClass()
    return {
        new = function(_, opts)
            opts = opts or {}
            if not opts.getSize then
                function opts:getSize()
                    return { w = 100, h = 20 }
                end
            end
            return opts
        end,
    }
end

package.loaded["ffi/blitbuffer"] = { COLOR_DARK_GRAY = 1, COLOR_LIGHT_GRAY = 2 }
package.loaded["ui/widget/button"] = widgetClass()
package.loaded["ui/widget/container/centercontainer"] = widgetClass()
package.loaded["ui/font"] = {
    getFace = function()
        return {}
    end,
}
package.loaded["ui/geometry"] = widgetClass()
package.loaded["ui/widget/horizontalgroup"] = widgetClass()
package.loaded["ui/widget/horizontalspan"] = widgetClass()
package.loaded["ui/widget/infomessage"] = widgetClass()
package.loaded["ui/widget/linewidget"] = widgetClass()
package.loaded["ui/network/manager"] = {
    isConnected = function()
        return connected
    end,
}
package.loaded["device"] = {
    screen = {
        scaleBySize = function(_, value)
            return value
        end,
    },
}
package.loaded["ui/size"] = {
    line = { thin = 1 },
    padding = { large = 8 },
    span = { horizontal_default = 4, vertical_default = 4 },
}
package.loaded["ui/widget/textboxwidget"] = widgetClass()
package.loaded["ui/uimanager"] = {
    show = function() end,
}
package.loaded["ui/widget/verticalgroup"] = widgetClass()
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {}
package.loaded["bookorbit_catalog_widgets"] = {}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local Capabilities = require("bookorbit_capabilities")
local CatalogDashboard = require("bookorbit_catalog_dashboard")
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local author_source = { type = "authors", sourceName = "Ursula K. Le Guin", params = { author = "Ursula K. Le Guin", sort = "title" } }

local requests
local last_section

local function newCatalog(opts)
    opts = opts or {}
    Capabilities.reset()
    requests = {}
    last_section = nil
    local stored_sections = opts.sections
    if opts.section then
        stored_sections = { opts.section, schemaVersion = DashboardSections.LEGACY_SCHEMA_VERSION }
    end
    local catalog = {
        title = "BookOrbit",
        settings = {
            catalog_dashboard_cache = opts.cache,
            catalog_dashboard_cache_section = opts.cache_section,
            [DashboardSections.SETTING_KEY] = stored_sections,
        },
        client = {
            server_url = opts.server_url or "https://example.test",
            username = "reader",
            getPluginVersion = function()
                table.insert(requests, "version")
                if opts.capability_error then return nil, opts.capability_error end
                return { capabilities = opts.capabilities or {} }
            end,
            catalogDashboard = function(_, section)
                table.insert(requests, "dashboard")
                last_section = section
                if section and opts.reject_section then return nil, opts.reject_section end
                local body = { continueReading = {} }
                if not opts.omit_discover then body.discover = {} end
                if section then
                    body.section = { type = section.type, smartScopeId = section.smartScopeId, books = { { id = 9 } } }
                    body.discover = {}
                end
                return body
            end,
            catalogBooks = function(_, params)
                table.insert(requests, "books:" .. tostring(params.sort))
                if opts.catalog_books_error and opts.catalog_books_error[params.sort] then
                    return nil, opts.catalog_books_error[params.sort]
                end
                local ids = { recently_added = 11, recently_read = 12, title = 13 }
                return { items = { { id = ids[params.sort] or 9 } }, page = 1, size = params.size, total = 1 }
            end,
            catalogDiscover = function()
                table.insert(requests, "discover")
                if opts.discover_error then return nil, opts.discover_error end
                return { discover = { { id = 14 } } }
            end,
        },
    }
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then catalog[name] = fn end
    end
    function catalog:persistSetting(key, value)
        self.settings[key] = value
    end
    function catalog:fetch(_, fn)
        return fn()
    end
    return catalog
end

-- Dashboard shelves no longer use the old pseudo-section endpoint.
local catalog = newCatalog{}
assertEqual(catalog:dashboardSectionRequest(), nil, "the default dashboard sends no pseudo-section parameter")
assertEqual(#requests, 0, "the default dashboard does not probe capabilities")

catalog = newCatalog{ section = { type = "recently-added" } }
assertEqual(catalog:dashboardSectionRequest().type, "recently-added", "the compatibility helper returns a real book source")

catalog = newCatalog{ section = { type = "authors" } }
assertEqual(catalog:dashboardSectionRequest(), nil, "catalog destinations do not masquerade as book feeds")

-- Grid books are stored by slot.
assertEqual(CatalogDashboard.dashboardSlotBooks({ dashboardSlots = { [3] = { books = { { id = 2 } } } } }, 3)[1].id, 2,
    "a grid slot exposes its own books")
assertEqual(#CatalogDashboard.dashboardSlotBooks(nil, 3), 0, "no body yields no books")

-- Thumbnail prefetching sees every configured grid slot, including all twelve
-- prefetched items per shelf.
local twelve = {}
for id = 1, 12 do twelve[id] = { id = id + 10 } end
local prefetch = CatalogDashboard.dashboardBooks({
    continueReading = { { id = 1 } },
    dashboardSlots = {
        [1] = { type = "recently-added", books = twelve },
        [2] = { type = "want-to-read", books = { { id = 30 }, { id = 31 } } },
    },
})
assertEqual(#prefetch, 15, "prefetching covers Continue reading and every grid slot")

-- Real book shelves use the ordinary catalog books endpoint and request twelve
-- items, including filters selected through the existing catalog lists.
catalog = newCatalog{
    sections = {
        { type = "recently-added" },
        author_source,
        schemaVersion = DashboardSections.LEGACY_SCHEMA_VERSION,
    },
}
local _, refreshed = catalog:dashboardRoot()
assertEqual(refreshed.dashboard.dashboardSlots[1].type, "stats", "slot 1 keeps its native Stats renderer")
assertEqual(refreshed.dashboard.dashboardSlots[2].type, "continue-reading", "slot 2 keeps its native Continue reading renderer")
assertEqual(refreshed.dashboard.dashboardSlots[3].type, "recently-added", "the first old row migrates to slot 3")
assertEqual(refreshed.dashboard.dashboardSlots[3].books[1].id, 11, "Recently added loads from catalog books")
assertEqual(refreshed.dashboard.dashboardSlots[4].books[1].id, 13, "the selected author loads independently")
assertEqual(catalog.settings.catalog_dashboard_cache_section,
    "stats|continue-reading|recently-added|authors:author=Ursula K. Le Guin:sort=title",
    "the cache records the selected catalog filter")
assertEqual(catalog:dashboardCacheMatchesSection(), true, "the cache matches the full four-slot configuration")

-- Discover falls back to the dedicated endpoint when the dashboard payload does
-- not include a preloaded discover list.
catalog = newCatalog{ omit_discover = true }
local _, discovered = catalog:dashboardRoot()
assertEqual(discovered.dashboard.dashboardSlots[3].books[1].id, 14,
    "a missing dashboard discover list falls back to catalogDiscover")
assertEqual(requests[2], "discover", "the dedicated discover endpoint is requested")

-- A failed shelf request only empties that shelf; the dashboard and later slots
-- remain available.
catalog = newCatalog{
    sections = {
        { type = "stats" },
        { type = "recently-added" },
        { type = "in-progress" },
        { type = "browse" },
        schemaVersion = DashboardSections.SCHEMA_VERSION,
    },
    catalog_books_error = { recently_added = 500 },
}
local _, partial = catalog:dashboardRoot()
assertEqual(partial.dashboard ~= nil, true, "one shelf failure does not discard the dashboard")
assertEqual(#partial.dashboard.dashboardSlots[2].books, 0, "the failed shelf degrades to an empty list")
assertEqual(partial.dashboard.dashboardSlots[3].books[1].id, 12, "later shelves continue loading")

-- A cached body fetched for another four-slot configuration is still shown, but
-- its grid shelves are marked pending until the refresh lands.
catalog = newCatalog{
    section = { type = "recently-added" },
    cache = { continueReading = {}, dashboardSlots = {} },
    cache_section = "stats|continue-reading|random|browse",
}
local _, cached_context = catalog:initialDashboardContext()
assertEqual(cached_context.dashboard ~= nil, true, "the rest of the cached dashboard is still shown")
assertEqual(cached_context.section_stale[3], true, "a cache from another slot configuration marks grid slots pending")

catalog = newCatalog{
    section = { type = "recently-added" },
    cache = { continueReading = {}, dashboardSlots = {} },
    cache_section = "stats|continue-reading|recently-added|browse",
}
local _, matching_context = catalog:initialDashboardContext()
assertEqual(matching_context.section_stale, nil, "a cache from the same four-slot configuration is used as is")

-- Only a random row offers a reshuffle; every other source has an order the
-- server chose.
catalog = newCatalog{}
assertEqual(catalog:dashboardSectionSupportsReroll({ type = "random" }), true, "Discover can be rerolled")
assertEqual(catalog:dashboardSectionSupportsReroll({ type = "recently-added" }), false, "an ordered source cannot be rerolled")

-- Choosing a new slot source persists it and marks all cached grid shelves
-- pending until the refresh lands.
catalog = newCatalog{}
catalog.current_context = { kind = "dashboard", dashboard = { continueReading = {}, dashboardSlots = {} } }
local refreshes = 0
function catalog:dashboardMode() return true end
function catalog:updateItems() end
function catalog:refreshCurrent() refreshes = refreshes + 1 end
catalog:setDashboardSection(author_source, 3)
assertEqual(catalog.settings[DashboardSections.SETTING_KEY][3].type, "authors", "the new slot choice is persisted")
assertEqual(catalog.current_context.section_stale[3], true, "only the changed dashboard slot is marked pending")
assertEqual(refreshes, 1, "choosing a slot source refreshes the dashboard")

-- Re-picking the current slot source is a no-op rather than a needless refresh.
catalog:setDashboardSection(author_source, 3)
assertEqual(refreshes, 1, "re-picking the same slot source does not refresh")

print("bookorbit_catalog_dashboard_section_test.lua: ok")
