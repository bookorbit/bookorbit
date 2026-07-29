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

-- A stored choice that cannot be honoured falls back to Discover rather than
-- leaving the row undefined.
assertEqual(DashboardSections.normalizeEntry(nil).type, "random", "a missing entry degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "not-a-source" }).type, "random", "an unknown type degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "smart-scope" }).type, "random", "a scope without an id degrades to Discover")
assertEqual(DashboardSections.normalizeEntry({ type = "want-to-read" }).type, "want-to-read", "a known type is kept")
assertEqual(DashboardSections.normalizeEntry({ type = "smart-scope", smartScopeId = "4" }).smartScopeId, 4, "a numeric scope id is coerced")

local defaults = DashboardSections.normalize(nil)
assertEqual(#defaults, 4, "the dashboard always has four slots")
assertEqual(defaults[1].type, "stats", "slot 1 defaults to Stats")
assertEqual(defaults[2].type, "continue-reading", "slot 2 defaults to Continue reading")
assertEqual(defaults[3].type, "random", "slot 3 defaults to Discover")
assertEqual(defaults[4].type, "browse", "slot 4 defaults to Browse")
local migrated = DashboardSections.normalize({ { type = "want-to-read" }, { type = "smart-scope", smartScopeId = 4 } })
assertEqual(migrated[3].type, "want-to-read", "the old first configurable row migrates to slot 3")
assertEqual(migrated[4].type, "smart-scope", "the old second configurable row migrates to slot 4")

assertEqual(DashboardSections.signature({ type = "recently-added" }), "recently-added", "a plain type signs as itself")
assertEqual(DashboardSections.signature({ type = "smart-scope", smartScopeId = 4 }), "smart-scope:4", "a scope signs with its id")
assertEqual(DashboardSections.signature({ type = "smart-scope", smartScopeId = 5 })
    ~= DashboardSections.signature({ type = "smart-scope", smartScopeId = 4 }), true, "two scopes sign differently")

assertEqual(DashboardSections.headerText({ type = "want-to-read" }), "Want to read", "a plain row is titled by its source")
assertEqual(DashboardSections.headerText({ type = "smart-scope", smartScopeId = 4, smartScopeName = "Sci-fi" }), "Sci-fi",
    "a scope row is titled by the scope")

local requests
local last_section

local function newCatalog(opts)
    opts = opts or {}
    Capabilities.reset()
    requests = {}
    last_section = nil
    local catalog = {
        title = "BookOrbit",
        settings = {
            catalog_dashboard_cache = opts.cache,
            catalog_dashboard_cache_section = opts.cache_section,
            [DashboardSections.SETTING_KEY] = opts.sections or (opts.section and { opts.section } or nil),
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
                local body = { continueReading = {}, discover = {} }
                if section then
                    body.section = { type = section.type, smartScopeId = section.smartScopeId, books = { { id = 9 } } }
                    body.discover = {}
                end
                return body
            end,
            catalogDashboardSection = function(_, section)
                table.insert(requests, "section:" .. section.type)
                local ids = { ["want-to-read"] = 10, ["recently-added"] = 11, ["up-next-in-series"] = 12, ["smart-scope"] = 13 }
                return { type = section.type, smartScopeId = section.smartScopeId, books = { { id = ids[section.type] or 9 } } }
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

-- Discover is the default, so the common case puts no parameter on the wire.
local catalog = newCatalog{}
assertEqual(catalog:dashboardSectionRequest(), nil, "the default row sends no section parameter")
assertEqual(#requests, 0, "the default row does not probe capabilities")

-- A non-default choice is sent directly. dashboardRoot owns the compatibility
-- fallback when an older server rejects the section parameter.
catalog = newCatalog{ section = { type = "want-to-read" }, capabilities = { "catalogDashboardSections" } }
assertEqual(catalog:dashboardSectionRequest().type, "want-to-read", "an advertised capability sends the section")

catalog = newCatalog{ section = { type = "want-to-read" }, capabilities = {} }
assertEqual(catalog:dashboardSectionRequest().type, "want-to-read", "a missing capability advertisement does not suppress the selected section")

catalog = newCatalog{ section = { type = "want-to-read" }, capability_error = 503 }
assertEqual(catalog:dashboardSectionRequest().type, "want-to-read", "a transient capability probe failure does not suppress the selected section")

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

-- Successful requests for two named sections cache both migrated grid slots.
catalog = newCatalog{
    sections = { { type = "want-to-read" }, { type = "recently-added" } },
    capabilities = { "catalogDashboardSections" },
}
local _, refreshed = catalog:dashboardRoot()
assertEqual(refreshed.dashboard.dashboardSlots[1].type, "stats", "slot 1 keeps its native Stats renderer")
assertEqual(refreshed.dashboard.dashboardSlots[2].type, "continue-reading", "slot 2 keeps its native Continue reading renderer")
assertEqual(refreshed.dashboard.dashboardSlots[3].type, "want-to-read", "the old first row migrates to grid slot 3")
assertEqual(refreshed.dashboard.dashboardSlots[3].books[1].id, 10, "slot 3 receives its own books")
assertEqual(refreshed.dashboard.dashboardSlots[4].books[1].id, 11, "slot 4 is fetched independently")
assertEqual(catalog.settings.catalog_dashboard_cache_section, "stats|continue-reading|want-to-read|recently-added",
    "the cache records all four slot sources")
assertEqual(catalog:dashboardCacheMatchesSection(), true, "the cache matches the full four-slot configuration")

-- The full dashboard is always fetched without a section parameter; configured
-- grid slots come from the dedicated section endpoint instead.
catalog = newCatalog{
    section = { type = "want-to-read" },
    capabilities = { "catalogDashboardSections" },
    reject_section = 400,
}
local _, recovered = catalog:dashboardRoot()
assertEqual(recovered.dashboard ~= nil, true, "the base dashboard still loads")
assertEqual(recovered.dashboard.dashboardSlots[3].type, "want-to-read", "the selected grid slot does not depend on the full-dashboard query parameter")

-- A cached body fetched for another four-slot configuration is still shown, but
-- its grid shelves are marked pending until the refresh lands.
catalog = newCatalog{
    section = { type = "want-to-read" },
    cache = { continueReading = {}, dashboardSlots = {} },
    cache_section = "stats|continue-reading|random|browse",
}
local _, cached_context = catalog:initialDashboardContext()
assertEqual(cached_context.dashboard ~= nil, true, "the rest of the cached dashboard is still shown")
assertEqual(cached_context.section_stale, true, "a cache from another slot configuration marks grids pending")

catalog = newCatalog{
    section = { type = "want-to-read" },
    cache = { continueReading = {}, dashboardSlots = {} },
    cache_section = "stats|continue-reading|want-to-read|browse",
}
local _, matching_context = catalog:initialDashboardContext()
assertEqual(matching_context.section_stale, false, "a cache from the same four-slot configuration is used as is")

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
catalog:setDashboardSection({ type = "up-next-in-series" }, 3)
assertEqual(catalog.settings[DashboardSections.SETTING_KEY][3].type, "up-next-in-series", "the new slot choice is persisted")
assertEqual(catalog.current_context.section_stale, true, "the visible grid shelves are marked pending")
assertEqual(refreshes, 1, "choosing a slot source refreshes the dashboard")

-- Re-picking the current slot source is a no-op rather than a needless refresh.
catalog:setDashboardSection({ type = "up-next-in-series" }, 3)
assertEqual(refreshes, 1, "re-picking the same slot source does not refresh")

print("bookorbit_catalog_dashboard_section_test.lua: ok")
