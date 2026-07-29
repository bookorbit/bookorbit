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
            [DashboardSections.SETTING_KEY] = opts.section and { opts.section } or nil,
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

-- The books come from the section when the body carries one, and from the
-- legacy discover field otherwise.
assertEqual(#CatalogDashboard.dashboardSectionBooks({ discover = { { id = 1 } } }), 1, "a legacy body reads discover")
assertEqual(CatalogDashboard.dashboardSectionBooks({ discover = { { id = 1 } }, section = { books = { { id = 2 } } } })[1].id, 2,
    "a section body wins over the legacy field")
assertEqual(#CatalogDashboard.dashboardSectionBooks(nil), 0, "no body yields no books")

-- Thumbnail prefetching has to see the configured row's books, not just discover.
local prefetch = CatalogDashboard.dashboardBooks({
    continueReading = { { id = 1 } },
    section = { books = { { id = 2 }, { id = 3 } } },
})
assertEqual(#prefetch, 3, "prefetching covers continue reading and the configured row")

-- A successful request for a named section caches the body under that section's
-- signature, so a later open recognises it.
catalog = newCatalog{ section = { type = "want-to-read" }, capabilities = { "catalogDashboardSections" } }
local _, refreshed = catalog:dashboardRoot()
assertEqual(last_section.type, "want-to-read", "the configured section reaches the client")
assertEqual(refreshed.dashboard.section.books[1].id, 9, "the section body is what gets rendered")
assertEqual(catalog.settings.catalog_dashboard_cache_section, "want-to-read", "the cache records which section it holds")
assertEqual(catalog:dashboardCacheMatchesSection(), true, "the cache matches the configuration it was fetched for")

-- A server that advertises the capability but rejects the parameter is a
-- definitive answer: retry once without it rather than show nothing.
catalog = newCatalog{
    section = { type = "want-to-read" },
    capabilities = { "catalogDashboardSections" },
    reject_section = 400,
}
local _, recovered = catalog:dashboardRoot()
assertEqual(recovered.dashboard ~= nil, true, "a rejected parameter still produces a dashboard")
assertEqual(recovered.dashboard.section, nil, "the retry falls back to the legacy body")
assertEqual(Capabilities.supports(catalog.client, DashboardSections.CAPABILITY), false, "the rejection downgrades the session")

-- A cached body fetched for another section is still shown, but its row is
-- marked pending so stale books are never presented as the new choice.
catalog = newCatalog{
    section = { type = "want-to-read" },
    cache = { continueReading = {}, discover = { { id = 2 } } },
    cache_section = "random",
}
local _, cached_context = catalog:initialDashboardContext()
assertEqual(cached_context.dashboard ~= nil, true, "the rest of the cached dashboard is still shown")
assertEqual(cached_context.section_stale, true, "a cache from another section marks the row pending")

catalog = newCatalog{
    section = { type = "want-to-read" },
    cache = { continueReading = {}, discover = {} },
    cache_section = "want-to-read",
}
local _, matching_context = catalog:initialDashboardContext()
assertEqual(matching_context.section_stale, false, "a cache from the same section is used as is")

-- Only a random row offers a reshuffle; every other source has an order the
-- server chose.
catalog = newCatalog{}
assertEqual(catalog:dashboardSectionSupportsReroll({ type = "random" }), true, "Discover can be rerolled")
assertEqual(catalog:dashboardSectionSupportsReroll({ type = "recently-added" }), false, "an ordered source cannot be rerolled")

-- Choosing a new section persists it and marks the visible row pending until
-- the refresh lands.
catalog = newCatalog{}
catalog.current_context = { kind = "dashboard", dashboard = { continueReading = {}, discover = {} } }
local refreshes = 0
function catalog:dashboardMode() return true end
function catalog:updateItems() end
function catalog:refreshCurrent() refreshes = refreshes + 1 end
catalog:setDashboardSection({ type = "up-next-in-series" })
assertEqual(catalog.settings[DashboardSections.SETTING_KEY][1].type, "up-next-in-series", "the new choice is persisted")
assertEqual(catalog.current_context.section_stale, true, "the visible row is marked pending")
assertEqual(refreshes, 1, "choosing a section refreshes the dashboard")

-- Re-picking the current section is a no-op rather than a needless refresh.
catalog:setDashboardSection({ type = "up-next-in-series" })
assertEqual(refreshes, 1, "re-picking the same section does not refresh")

print("bookorbit_catalog_dashboard_section_test.lua: ok")
