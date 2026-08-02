-- Proves the configurable dashboard slots: what each shelf costs in requests,
-- how a failing or repeated source is handled, how shelves are measured, and
-- how a cached body fetched for a different configuration is treated.

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
package.loaded["ui/widget/textwidget"] = widgetClass()
package.loaded["ui/uimanager"] = {
    show = function() end,
}
package.loaded["ui/widget/verticalgroup"] = widgetClass()
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {}
package.loaded["bookorbit_catalog_widgets"] = {
    DashboardCoverCard = widgetClass(),
    DashboardHeroCard = widgetClass(),
    DashboardBrowseRow = widgetClass(),
    DashboardIconButton = widgetClass(),
    coverCardHeight = function(card_w)
        return card_w + 20
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDashboard = require("bookorbit_catalog_dashboard")
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local author_source = { type = "authors", sourceName = "Ursula K. Le Guin", params = { author = "Ursula K. Le Guin", sort = "title" } }

local requests
local last_books_params

local function newCatalog(opts)
    opts = opts or {}
    requests = {}
    last_books_params = nil
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
            catalogDashboard = function(_, section)
                table.insert(requests, "dashboard")
                assertEqual(section, nil, "the dashboard body is requested without a section parameter")
                local body = { continueReading = {} }
                if not opts.omit_discover then body.discover = {} end
                return body
            end,
            catalogBooks = function(_, params)
                table.insert(requests, "books:" .. tostring(params.sort))
                last_books_params = params
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
            catalogDashboardSection = function(_, section_type)
                table.insert(requests, "section:" .. tostring(section_type))
                if opts.section_endpoint_error then return nil, opts.section_endpoint_error end
                return { section = { type = section_type, books = { { id = 21 } } } }
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

-- The default dashboard is one request: Discover is served from the body that
-- was already fetched, and no capability is probed.
local catalog = newCatalog{}
catalog:dashboardRoot()
assertEqual(#requests, 1, "the default dashboard costs a single request")
assertEqual(requests[1], "dashboard", "the default dashboard only fetches the dashboard body")

-- Grid books are stored by slot.
assertEqual(CatalogDashboard.dashboardSlotBooks({ dashboardSlots = { [3] = { books = { { id = 2 } } } } }, 3)[1].id, 2,
    "a grid slot exposes its own books")
assertEqual(#CatalogDashboard.dashboardSlotBooks(nil, 3), 0, "no body yields no books")

-- Grid geometry is computed from the measured content width and native slot
-- count rather than from source-text constants.
catalog = newCatalog{}
catalog.content_w = 500
catalog.dash_inner_gap = 9
local slots, card_w, grid_h = catalog:sectionRowMetrics(12, 6)
assertEqual(slots, 6, "a wide dashboard budgets six cover slots, the column cap")
assertEqual(card_w, 78, "cover width subtracts only the five inter-card gaps")
assertEqual(grid_h, 98, "grid height follows the measured cover-card height")

catalog.content_w = 320
slots, card_w, grid_h = catalog:sectionRowMetrics(12, 6)
assertEqual(slots, 4, "slot count shrinks until the minimum cover width fits")
assertEqual(card_w, 75, "the narrower grid recomputes its card width")
assertEqual(grid_h, 95, "the narrower grid recomputes its card height")

-- A shelf under a height budget gets more, narrower cards. The row height is
-- always the height those cards need, so covers are never drawn out of aspect.
catalog.content_w = 500
slots, card_w, grid_h = catalog:shelfRowMetrics(12, 6, 999)
assertEqual(slots, 6, "a shelf with room to spare keeps its natural row")
assertEqual(grid_h, 98, "an unconstrained shelf keeps its natural height")

slots, card_w, grid_h = catalog:shelfRowMetrics(12, 6, 100)
assertEqual(slots, 6, "a tight shelf fits more cards per row")
assertEqual(card_w, 78, "the extra card makes every card narrower")
assertEqual(grid_h, card_w + 20, "the row height is the height the narrower card needs")

slots, card_w, grid_h = catalog:shelfRowMetrics(12, 6, 1)
assertEqual(card_w, 78, "cards never shrink past their minimum width")
assertEqual(grid_h, card_w + 20, "an impossible budget still yields an in-aspect row")

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
assertEqual(last_books_params.size, 12, "a shelf requests a full page of books")
assertEqual(last_books_params.page, 1, "a shelf always requests its first page")

-- Slots pointing at the same source share one request rather than fetching the
-- same books twice.
catalog = newCatalog{
    sections = {
        { type = "random" },
        { type = "recently-added" },
        { type = "recently-added" },
        { type = "random" },
        schemaVersion = DashboardSections.SCHEMA_VERSION,
    },
}
local _, deduped = catalog:dashboardRoot()
assertEqual(#requests, 2, "four shelves over two sources cost two requests")
assertEqual(requests[2], "books:recently_added", "the repeated source is fetched once")
assertEqual(deduped.dashboard.dashboardSlots[3].books[1].id, 11, "the repeated shelf still gets its books")
assertEqual(deduped.dashboard.dashboardSlots[1].books, deduped.dashboard.dashboardSlots[4].books,
    "two Discover slots render the same fetched list")

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

-- Server-composed sources go through the dashboard-section endpoint; distinct
-- sources cost one request each and land in their slots.
local Capabilities = require("bookorbit_capabilities")
Capabilities.reset()
catalog = newCatalog{
    sections = {
        { type = "stats" },
        { type = "want-to-read" },
        { type = "up-next-in-series" },
        { type = "browse" },
        schemaVersion = DashboardSections.SCHEMA_VERSION,
    },
}
local _, server_sections = catalog:dashboardRoot()
assertEqual(requests[2], "section:want-to-read", "Want to read fetches through the section endpoint")
assertEqual(requests[3], "section:up-next-in-series", "Up next in series fetches through the section endpoint")
assertEqual(server_sections.dashboard.dashboardSlots[2].books[1].id, 21, "the section endpoint's books land in the slot")

-- A 404 from the section endpoint downgrades the capability: the shelf
-- degrades to empty, and later fetches skip the endpoint entirely.
Capabilities.reset()
catalog = newCatalog{
    sections = {
        { type = "stats" },
        { type = "want-to-read" },
        { type = "random" },
        { type = "browse" },
        schemaVersion = DashboardSections.SCHEMA_VERSION,
    },
    section_endpoint_error = 404,
}
local _, downgraded = catalog:dashboardRoot()
assertEqual(#downgraded.dashboard.dashboardSlots[2].books, 0, "an unsupported section degrades to an empty shelf")
assertEqual(Capabilities.cached(catalog.client)[DashboardSections.SECTION_ENDPOINT_CAPABILITY], false,
    "a confirmed 404 records the missing capability")
requests = {}
catalog:dashboardRoot()
local section_requests = 0
for _, request in ipairs(requests) do
    if request:find("^section:") then section_requests = section_requests + 1 end
end
assertEqual(section_requests, 0, "a known-missing capability skips the section endpoint")
Capabilities.reset()

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

-- Restoring the defaults rewrites every slot but still refreshes once, and
-- marks the pending slots as the renderer expects to read them.
catalog:setDashboardSections(DashboardSections.normalize(nil))
assertEqual(catalog.settings[DashboardSections.SETTING_KEY][3].type, "random", "the reset restores the default slot sources")
assertEqual(refreshes, 2, "a reset refreshes the dashboard once, not once per slot")
for index = 1, DashboardSections.SLOT_COUNT do
    assertEqual(catalog.current_context.section_stale[index], true, "a reset marks every slot pending")
end

catalog:setDashboardSections(DashboardSections.normalize(nil))
assertEqual(refreshes, 2, "resetting an already-default dashboard does not refresh")

print("bookorbit_catalog_dashboard_section_test.lua: ok")
